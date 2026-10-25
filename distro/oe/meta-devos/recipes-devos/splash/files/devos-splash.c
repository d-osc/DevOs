/*
 * devos-splash: the Dev OS boot/shutdown animation.
 *
 * One small static program that draws procedurally (no image data) to the framebuffer (/dev/fb0, provided by
 * simpledrm and later the msm DRM driver through fbdev emulation). It runs from the initramfs and keeps running
 * across switch_root until the session asks it to quit, so there is never a text console on screen in between.
 *
 *   devos-splash --daemon [--pid FILE] [--status FILE] [--control FILE] [--message TEXT] [--timeout SECONDS]
 *   devos-splash --quit [--text]          fade out and hand the screen over (--text: restore the text console now)
 *   devos-splash --dump DIR [--frames N] [--size WxH] [--message TEXT] [--fade] [--full]   headless PPM frames
 *
 * Drawing is OLED friendly: a black background, a thin accent arc and small dot-matrix text, 30 frames/s at most,
 * only the arc rectangle is rewritten per frame, and the whole mark drifts a few pixels over minutes.
 * The daemon runs as root; the greeter user asks it to quit through the world-writable control file.
 * The text console stays in text mode but is hidden (black on black, no cursor); KD_GRAPHICS would keep fbcon from
 * programming the panel after msm replaces simpledrm.
 * Signals: USR1 fade out and leave a blank console; TERM/INT/HUP show the console in normal colours immediately.
 * Escape hatches: any key press (after one second) or the --timeout watchdog restore the text console, which keeps
 * everything that was printed meanwhile. Nothing here ever holds the DRM master, so labwc can start safely.
 */
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <linux/fb.h>
#include <linux/input.h>
#include <linux/kd.h>
#include <math.h>
#include <stdarg.h>
#include <poll.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>

#define FPS 30
#define LOOP_SECONDS 4.8f            /* the arc animation repeats exactly after this long */
#define FADE_IN 0.8f
#define FADE_OUT 0.45f
#define MAX_INPUTS 12
#define TAU 6.28318530717958647692f

/* Dark 2026 colours (extensions/org.devos.theme/vscode/2026-dark.json): accent #3994BC, link #48A0C7, text #bfbfbf. */
static const int ACCENT[3] = {0x39, 0x94, 0xBC}, HIGHLIGHT[3] = {0x48, 0xA0, 0xC7}, TEXT[3] = {0xBF, 0xBF, 0xBF}, MUTED[3] = {0x6E, 0x6E, 0x6E};

/* Classic 5x7 dot-matrix font, ASCII 32..126, one byte per column, bit 0 is the top row. */
static const uint8_t FONT[95][5] = {
    {0x00,0x00,0x00,0x00,0x00},{0x00,0x00,0x5F,0x00,0x00},{0x00,0x07,0x00,0x07,0x00},{0x14,0x7F,0x14,0x7F,0x14},
    {0x24,0x2A,0x7F,0x2A,0x12},{0x23,0x13,0x08,0x64,0x62},{0x36,0x49,0x56,0x20,0x50},{0x00,0x05,0x03,0x00,0x00},
    {0x00,0x1C,0x22,0x41,0x00},{0x00,0x41,0x22,0x1C,0x00},{0x14,0x08,0x3E,0x08,0x14},{0x08,0x08,0x3E,0x08,0x08},
    {0x00,0x50,0x30,0x00,0x00},{0x08,0x08,0x08,0x08,0x08},{0x00,0x60,0x60,0x00,0x00},{0x20,0x10,0x08,0x04,0x02},
    {0x3E,0x51,0x49,0x45,0x3E},{0x00,0x42,0x7F,0x40,0x00},{0x42,0x61,0x51,0x49,0x46},{0x21,0x41,0x45,0x4B,0x31},
    {0x18,0x14,0x12,0x7F,0x10},{0x27,0x45,0x45,0x45,0x39},{0x3C,0x4A,0x49,0x49,0x30},{0x01,0x71,0x09,0x05,0x03},
    {0x36,0x49,0x49,0x49,0x36},{0x06,0x49,0x49,0x29,0x1E},{0x00,0x36,0x36,0x00,0x00},{0x00,0x56,0x36,0x00,0x00},
    {0x08,0x14,0x22,0x41,0x00},{0x14,0x14,0x14,0x14,0x14},{0x00,0x41,0x22,0x14,0x08},{0x02,0x01,0x51,0x09,0x06},
    {0x32,0x49,0x79,0x41,0x3E},{0x7E,0x11,0x11,0x11,0x7E},{0x7F,0x49,0x49,0x49,0x36},{0x3E,0x41,0x41,0x41,0x22},
    {0x7F,0x41,0x41,0x22,0x1C},{0x7F,0x49,0x49,0x49,0x41},{0x7F,0x09,0x09,0x09,0x01},{0x3E,0x41,0x49,0x49,0x7A},
    {0x7F,0x08,0x08,0x08,0x7F},{0x00,0x41,0x7F,0x41,0x00},{0x20,0x40,0x41,0x3F,0x01},{0x7F,0x08,0x14,0x22,0x41},
    {0x7F,0x40,0x40,0x40,0x40},{0x7F,0x02,0x0C,0x02,0x7F},{0x7F,0x04,0x08,0x10,0x7F},{0x3E,0x41,0x41,0x41,0x3E},
    {0x7F,0x09,0x09,0x09,0x06},{0x3E,0x41,0x51,0x21,0x5E},{0x7F,0x09,0x19,0x29,0x46},{0x46,0x49,0x49,0x49,0x31},
    {0x01,0x01,0x7F,0x01,0x01},{0x3F,0x40,0x40,0x40,0x3F},{0x1F,0x20,0x40,0x20,0x1F},{0x3F,0x40,0x38,0x40,0x3F},
    {0x63,0x14,0x08,0x14,0x63},{0x07,0x08,0x70,0x08,0x07},{0x61,0x51,0x49,0x45,0x43},{0x00,0x7F,0x41,0x41,0x00},
    {0x02,0x04,0x08,0x10,0x20},{0x00,0x41,0x41,0x7F,0x00},{0x04,0x02,0x01,0x02,0x04},{0x40,0x40,0x40,0x40,0x40},
    {0x00,0x01,0x02,0x04,0x00},{0x20,0x54,0x54,0x54,0x78},{0x7F,0x48,0x44,0x44,0x38},{0x38,0x44,0x44,0x44,0x20},
    {0x38,0x44,0x44,0x48,0x7F},{0x38,0x54,0x54,0x54,0x18},{0x08,0x7E,0x09,0x01,0x02},{0x0C,0x52,0x52,0x52,0x3E},
    {0x7F,0x08,0x04,0x04,0x78},{0x00,0x44,0x7D,0x40,0x00},{0x20,0x40,0x44,0x3D,0x00},{0x7F,0x10,0x28,0x44,0x00},
    {0x00,0x41,0x7F,0x40,0x00},{0x7C,0x04,0x18,0x04,0x78},{0x7C,0x08,0x04,0x04,0x78},{0x38,0x44,0x44,0x44,0x38},
    {0x7C,0x14,0x14,0x14,0x08},{0x08,0x14,0x14,0x18,0x7C},{0x7C,0x08,0x04,0x04,0x08},{0x48,0x54,0x54,0x54,0x20},
    {0x04,0x3F,0x44,0x40,0x20},{0x3C,0x40,0x40,0x20,0x7C},{0x1C,0x20,0x40,0x20,0x1C},{0x3C,0x40,0x30,0x40,0x3C},
    {0x44,0x28,0x10,0x28,0x44},{0x0C,0x50,0x50,0x50,0x3C},{0x44,0x64,0x54,0x4C,0x44},{0x00,0x08,0x36,0x41,0x00},
    {0x00,0x00,0x7F,0x00,0x00},{0x00,0x41,0x36,0x08,0x00},{0x10,0x08,0x08,0x10,0x08},
};

static volatile sig_atomic_t signal_quit; /* 0 running, 1 fade out (USR1), 2 text console now (TERM/INT/HUP) */
static void on_signal(int sig) { signal_quit = sig == SIGUSR1 ? 1 : 2; }

static double now_seconds(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return ts.tv_sec + ts.tv_nsec / 1e9;
}
static float clampf(float v, float lo, float hi) { return v < lo ? lo : v > hi ? hi : v; }
static float ease(float v) { v = clampf(v, 0, 1); return v * v * (3 - 2 * v); }

/* ---- scene: a region of the screen centred on the display, holding the mark, the wordmark and the status line ---- */
typedef struct {
    int width, height;            /* region size in pixels */
    float unit;                   /* 1.0 at 1080 lines */
    float cx, cy, radius, stroke; /* the loading arc */
    uint8_t *word, *accent, *status;
    uint32_t *base, *frame;       /* 0x00RRGGBB */
    char message[64];
} Scene;

static void dot(uint8_t *mask, int w, int h, float cx, float cy, float r) {
    for (int y = (int)floorf(cy - r - 1); y <= (int)ceilf(cy + r + 1); y++)
        for (int x = (int)floorf(cx - r - 1); x <= (int)ceilf(cx + r + 1); x++) {
            if (x < 0 || y < 0 || x >= w || y >= h) continue;
            uint8_t v = (uint8_t)(clampf(r + .5f - hypotf(x + .5f - cx, y + .5f - cy), 0, 1) * 255);
            if (v > mask[y * w + x]) mask[y * w + x] = v;
        }
}
static float text_width(const char *s, float pitch) { return (float)strlen(s) * 6 * pitch - pitch; }
static void text(uint8_t *mask, int w, int h, const char *s, float x, float y, float pitch, float radius) {
    for (; *s; s++, x += 6 * pitch) {
        unsigned char c = (unsigned char)*s;
        const uint8_t *glyph = FONT[c < 32 || c > 126 ? '?' - 32 : c - 32];
        for (int col = 0; col < 5; col++)
            for (int row = 0; row < 7; row++)
                if (glyph[col] >> row & 1) dot(mask, w, h, x + (col + .5f) * pitch, y + (row + .5f) * pitch, radius);
    }
}
static uint32_t rgb_word(int r, int g, int b) {
    return (uint32_t)(r > 255 ? 255 : r) << 16 | (uint32_t)(g > 255 ? 255 : g) << 8 | (uint32_t)(b > 255 ? 255 : b);
}

static void scene_build_base(Scene *s) {
    int w = s->width, h = s->height;
    memset(s->word, 0, (size_t)w * h); memset(s->accent, 0, (size_t)w * h); memset(s->status, 0, (size_t)w * h);
    float u = s->unit, pitch = 5.2f * u, r = pitch * .43f;
    float total = text_width("DEV OS", pitch), x = w / 2.f - total / 2, y = 268 * u - 3.5f * pitch;
    text(s->word, w, h, "DEV", x, y, pitch, r);
    text(s->accent, w, h, "OS", x + 4 * 6 * pitch, y, pitch, r);
    float sp = fmaxf(2.4f, 3.0f * u);
    text(s->status, w, h, s->message, w / 2.f - text_width(s->message, sp) / 2, 338 * u - 3.5f * sp, sp, sp * .44f);
    for (int py = 0; py < h; py++)
        for (int px = 0; px < w; px++) {
            size_t i = (size_t)py * w + px;
            int rgb[3], a = s->word[i], b = s->accent[i], c = s->status[i];
            for (int k = 0; k < 3; k++) rgb[k] = (a * TEXT[k] + b * HIGHLIGHT[k] + c * MUTED[k]) / 255;
            float d = hypotf(px + .5f - s->cx, py + .5f - s->cy); /* faint track the arc runs along */
            float ring = clampf(s->stroke / 2 + .5f - fabsf(d - s->radius), 0, 1) * .10f;
            if (ring > 0) for (int k = 0; k < 3; k++) rgb[k] += (int)(ACCENT[k] * ring);
            s->base[i] = rgb_word(rgb[0], rgb[1], rgb[2]);
        }
}
static int scene_init(Scene *s, int screen_w, int screen_h, const char *message) {
    memset(s, 0, sizeof *s);
    float u = clampf(fminf(screen_h / 1080.f, screen_w / 1500.f), .5f, 3.f);
    s->unit = u; s->width = (int)(760 * u); s->height = (int)(420 * u);
    s->cx = s->width / 2.f; s->cy = 130 * u; s->radius = 56 * u; s->stroke = fmaxf(2.5f, 4.f * u);
    size_t n = (size_t)s->width * s->height;
    s->word = calloc(n, 1); s->accent = calloc(n, 1); s->status = calloc(n, 1);
    s->base = calloc(n, 4); s->frame = calloc(n, 4);
    if (!s->word || !s->accent || !s->status || !s->base || !s->frame) return -1;
    snprintf(s->message, sizeof s->message, "%s", message);
    scene_build_base(s);
    return 0;
}
static void scene_set_message(Scene *s, const char *message) {
    char clean[64];
    size_t n = 0;
    for (; *message && n < 46; message++) clean[n++] = (*message >= 32 && *message < 127) ? *message : ' ';
    if (*message && n > 3) memcpy(clean + n - 3, "...", 3);
    clean[n] = 0;
    if (strcmp(clean, s->message)) { snprintf(s->message, sizeof s->message, "%s", clean); scene_build_base(s); }
}
static void scene_free(Scene *s) {
    free(s->word); free(s->accent); free(s->status); free(s->base); free(s->frame);
    memset(s, 0, sizeof *s);
}

/* The rectangle (region coordinates) the arc and its glow can touch. */
static void arc_rect(const Scene *s, int *x0, int *y0, int *x1, int *y1) {
    float e = s->radius + 6 * s->stroke;
    *x0 = (int)fmaxf(0, s->cx - e); *y0 = (int)fmaxf(0, s->cy - e);
    *x1 = (int)fminf(s->width, s->cx + e + 1); *y1 = (int)fminf(s->height, s->cy + e + 1);
}
static void add_pixel(uint32_t *p, float r, float g, float b, float alpha) {
    int c[3] = {(int)(*p >> 16 & 255), (int)(*p >> 8 & 255), (int)(*p & 255)};
    float in[3] = {r, g, b};
    for (int k = 0; k < 3; k++) { c[k] += (int)(in[k] * alpha); if (c[k] > 216) c[k] = 216; } /* never full white on an OLED */
    *p = rgb_word(c[0], c[1], c[2]);
}
/* Draw the spinner for loop time t over the copy of base. Every term repeats exactly after LOOP_SECONDS. */
static void scene_compose(Scene *s, float t, int x0, int y0, int x1, int y1) {
    int w = s->width;
    for (int y = y0; y < y1; y++) memcpy(&s->frame[(size_t)y * w + x0], &s->base[(size_t)y * w + x0], (size_t)(x1 - x0) * 4);
    float phase = fmodf(t, LOOP_SECONDS) / LOOP_SECONDS;
    float length = (48 + 200 * (.5f - .5f * cosf(TAU * 3 * phase))) * TAU / 360;
    float head = TAU * 2 * phase + length * .9f;
    float hx = s->cx + s->radius * cosf(head), hy = s->cy + s->radius * sinf(head);
    float half = s->stroke / 2, inner = s->radius - half - 1, outer = s->radius + half + 1;
    float sigma = 1.4f * s->stroke;
    for (int y = y0; y < y1; y++)
        for (int x = x0; x < x1; x++) {
            float dx = x + .5f - s->cx, dy = y + .5f - s->cy, d2 = dx * dx + dy * dy;
            uint32_t *p = &s->frame[(size_t)y * w + x];
            if (d2 > inner * inner && d2 < outer * outer) {
                float cover = clampf(half + .5f - fabsf(sqrtf(d2) - s->radius), 0, 1);
                float behind = fmodf(head - atan2f(dy, dx) + 2 * TAU, TAU);
                if (cover > 0 && behind < length) {
                    float f = behind / length, a = powf(1 - f, 1.7f) * cover, hot = powf(1 - f, 3);
                    add_pixel(p, ACCENT[0] + (HIGHLIGHT[0] - ACCENT[0]) * hot, ACCENT[1] + (HIGHLIGHT[1] - ACCENT[1]) * hot,
                              ACCENT[2] + (HIGHLIGHT[2] - ACCENT[2]) * hot, a);
                }
            }
            float hd2 = (x + .5f - hx) * (x + .5f - hx) + (y + .5f - hy) * (y + .5f - hy);
            if (hd2 < 25 * s->stroke * s->stroke) { /* rounded head and a soft glow around it */
                float cap = clampf(half + .5f - sqrtf(hd2), 0, 1), glow = .22f * expf(-hd2 / (2 * sigma * sigma));
                add_pixel(p, HIGHLIGHT[0], HIGHLIGHT[1], HIGHLIGHT[2], cap);
                add_pixel(p, ACCENT[0], ACCENT[1], ACCENT[2], glow);
            }
        }
}
static void scale_region(Scene *s, int x0, int y0, int x1, int y1, float k) {
    if (k >= .999f) return;
    int m = (int)(clampf(k, 0, 1) * 256);
    for (int y = y0; y < y1; y++)
        for (int x = x0; x < x1; x++) {
            uint32_t *p = &s->frame[(size_t)y * s->width + x], v = *p;
            *p = ((v >> 16 & 255) * m >> 8) << 16 | ((v >> 8 & 255) * m >> 8) << 8 | ((v & 255) * m >> 8);
        }
}

/* ---- framebuffer output ---- */
typedef struct {
    int fd;
    uint8_t *map;
    size_t length;
    struct fb_var_screeninfo var;
    struct fb_fix_screeninfo fix;
} Display;

static int display_open(Display *d, const char *path) {
    memset(d, 0, sizeof *d);
    d->fd = -1;
    int fd = open(path, O_RDWR | O_CLOEXEC);
    if (fd < 0) return -1;
    if (ioctl(fd, FBIOGET_VSCREENINFO, &d->var) || ioctl(fd, FBIOGET_FSCREENINFO, &d->fix)
        || (d->var.bits_per_pixel != 32 && d->var.bits_per_pixel != 16) || d->var.xres < 320 || d->var.yres < 240) { close(fd); return -1; }
    d->length = d->fix.smem_len;
    d->map = mmap(NULL, d->length, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
    if (d->map == MAP_FAILED) { close(fd); d->map = NULL; return -1; }
    d->fd = fd;
    memset(d->map, 0, d->length);
    return 0;
}
static void display_close(Display *d) {
    if (d->map) munmap(d->map, d->length);
    if (d->fd >= 0) close(d->fd);
    d->map = NULL;
    d->fd = -1;
}
static int display_changed(const Display *d, const char *path) {
    struct fb_var_screeninfo var;
    struct fb_fix_screeninfo fix;
    int fd = open(path, O_RDWR | O_CLOEXEC);
    if (fd < 0) return 1;
    int bad = ioctl(fd, FBIOGET_VSCREENINFO, &var) || ioctl(fd, FBIOGET_FSCREENINFO, &fix);
    close(fd);
    return bad || var.xres != d->var.xres || var.yres != d->var.yres || var.bits_per_pixel != d->var.bits_per_pixel
        || fix.line_length != d->fix.line_length || fix.smem_start != d->fix.smem_start || strcmp((char *)fix.id, (char *)d->fix.id);
}
static uint32_t pack(const Display *d, uint32_t rgb) {
    uint32_t r = rgb >> 16 & 255, g = rgb >> 8 & 255, b = rgb & 255;
    return (r >> (8 - d->var.red.length)) << d->var.red.offset | (g >> (8 - d->var.green.length)) << d->var.green.offset
         | (b >> (8 - d->var.blue.length)) << d->var.blue.offset;
}
/* Copy a rectangle of the scene frame (region coordinates) to the screen, the region origin being (ox, oy). */
static void display_present(Display *d, const Scene *s, int ox, int oy, int x0, int y0, int x1, int y1) {
    int bytes = d->var.bits_per_pixel / 8;
    int fast = bytes == 4 && d->var.red.offset == 16 && d->var.green.offset == 8 && d->var.blue.offset == 0
        && d->var.red.length == 8 && d->var.green.length == 8 && d->var.blue.length == 8;
    for (int y = y0; y < y1; y++) {
        int sy = oy + y, from = x0, to = x1;
        if (sy < 0 || sy >= (int)d->var.yres) continue;
        if (ox + from < 0) from = -ox;
        if (ox + to > (int)d->var.xres) to = (int)d->var.xres - ox;
        if (to <= from) continue;
        uint8_t *line = d->map + (size_t)(sy + d->var.yoffset) * d->fix.line_length + (size_t)(ox + from + d->var.xoffset) * bytes;
        const uint32_t *src = &s->frame[(size_t)y * s->width + from];
        if (fast) memcpy(line, src, (size_t)(to - from) * 4);
        else if (bytes == 4) for (int x = 0; x < to - from; x++) ((uint32_t *)line)[x] = pack(d, src[x]);
        else for (int x = 0; x < to - from; x++) ((uint16_t *)line)[x] = (uint16_t)pack(d, src[x]);
    }
}

/* ---- virtual terminal, status file, key presses ---- */
/* The console stays in text mode (KD_GRAPHICS would stop fbcon from programming the panel when msm replaces simpledrm,
 * which leaves the screen black). It is hidden instead: black on black with no cursor. */
static int tty_hide(const char *path) {
    int fd = open(path, O_WRONLY | O_NOCTTY | O_CLOEXEC);
    if (fd < 0) return -1;
    static const char hidden[] = "\033[30;40m\033[?25l\033[2J\033[H";
    ssize_t written = write(fd, hidden, sizeof hidden - 1);
    close(fd);
    return written > 0 ? 0 : -1;
}
static void tty_show(const char *path, int clear) { /* normal colours again, optionally on a blank screen */
    int fd = open(path, O_WRONLY | O_NOCTTY | O_CLOEXEC);
    if (fd < 0) return;
    const char *text = clear ? "\033[0m\033[2J\033[H" : "\033[0m";
    ssize_t ignored = write(fd, text, strlen(text));
    (void)ignored;
    close(fd);
}
static void tty_write(const char *path, const char *message) {
    int fd = open(path, O_WRONLY | O_NOCTTY | O_CLOEXEC);
    if (fd < 0) return;
    ssize_t ignored = write(fd, message, strlen(message));
    (void)ignored;
    close(fd);
}
static int read_status(const char *path, char *out, size_t size) {
    FILE *f = fopen(path, "r");
    if (!f) return 0;
    char line[128] = "";
    if (!fgets(line, sizeof line, f)) line[0] = 0;
    fclose(f);
    line[strcspn(line, "\r\n")] = 0;
    if (!line[0]) return 0;
    snprintf(out, size, "%s", line);
    return 1;
}
static int open_inputs(int *fds, int count, char names[][32]) {
    for (int i = 0; i < 32; i++) {
        char path[32];
        snprintf(path, sizeof path, "/dev/input/event%d", i);
        int known = 0;
        for (int k = 0; k < count; k++) if (!strcmp(names[k], path)) known = 1;
        if (known || count >= MAX_INPUTS) continue;
        int fd = open(path, O_RDONLY | O_NONBLOCK | O_CLOEXEC);
        if (fd < 0) continue;
        snprintf(names[count], 32, "%s", path);
        fds[count++] = fd;
    }
    return count;
}

/* ---- options and modes ---- */
typedef struct {
    const char *fb, *tty, *pid, *status, *control, *dump, *message;
    int daemon, quit, text, frames, width, height, fade, full;
    double timeout;
} Options;

static int dump_frames(const Options *o) {
    Scene s;
    if (scene_init(&s, o->width, o->height, o->message)) return 1;
    mkdir(o->dump, 0755);
    for (int i = 0; i < o->frames; i++) {
        float t = (float)i / FPS;
        scene_compose(&s, t, 0, 0, s.width, s.height);
        if (o->fade) scale_region(&s, 0, 0, s.width, s.height, ease(t / FADE_IN));
        char path[512];
        snprintf(path, sizeof path, "%s/frame-%03d.ppm", o->dump, i);
        FILE *f = fopen(path, "wb");
        if (!f) return 1;
        int ow = s.width, oh = s.height;
        const uint32_t *source = s.frame;
        uint32_t *canvas = NULL;
        if (o->full) { /* the region on a black screen of the requested size, as it sits centred on the display */
            ow = o->width; oh = o->height;
            canvas = calloc((size_t)ow * oh, 4);
            for (int y = 0; y < s.height; y++)
                for (int x = 0; x < s.width; x++) {
                    int px = (ow - s.width) / 2 + x, py = (oh - s.height) / 2 + y;
                    if (px >= 0 && py >= 0 && px < ow && py < oh) canvas[(size_t)py * ow + px] = s.frame[(size_t)y * s.width + x];
                }
            source = canvas;
        }
        fprintf(f, "P6\n%d %d\n255\n", ow, oh);
        for (size_t k = 0; k < (size_t)ow * oh; k++) {
            uint8_t px[3] = {(uint8_t)(source[k] >> 16), (uint8_t)(source[k] >> 8), (uint8_t)source[k]};
            fwrite(px, 1, 3, f);
        }
        fclose(f);
        free(canvas);
    }
    printf("%d %d %d\n", s.width, s.height, o->frames);
    scene_free(&s);
    return 0;
}

static int client_quit(const Options *o) {
    FILE *f = fopen(o->pid, "r");
    int pid = 0;
    if (!f || fscanf(f, "%d", &pid) != 1 || pid <= 1) { if (f) fclose(f); return 0; } /* not running: nothing to do */
    fclose(f);
    int fd = open(o->control, O_WRONLY | O_TRUNC | O_CLOEXEC); /* works for any user; the signal below needs root */
    if (fd >= 0) { ssize_t ignored = write(fd, o->text ? "text\n" : "fade\n", 5); (void)ignored; close(fd); }
    kill(pid, o->text ? SIGTERM : SIGUSR1);
    for (int i = 0; i < 40 && (kill(pid, 0) == 0 || errno == EPERM); i++) usleep(50000);
    return 0;
}

static void control_poll(const char *path) {
    struct stat st;
    if (!path || stat(path, &st) || st.st_size == 0) return;
    char word[8] = "";
    FILE *f = fopen(path, "r");
    if (f) { if (!fgets(word, sizeof word, f)) word[0] = 0; fclose(f); }
    if (!strncmp(word, "text", 4)) signal_quit = 2; else if (!strncmp(word, "fade", 4) && signal_quit == 0) signal_quit = 1;
}

static double t_end(double start) { return now_seconds() - start; }
static FILE *event_log;
static double event_start;
static void note(const char *format, ...) { /* a line in /run/devos-splash.log: what the daemon saw, saved with the boot logs */
    if (!event_log) return;
    va_list args;
    fprintf(event_log, "%7.2f ", now_seconds() - event_start);
    va_start(args, format); vfprintf(event_log, format, args); va_end(args);
    fputc('\n', event_log);
    fflush(event_log);
}

/* The daemon is started from the initramfs and its root directory stays that initramfs after switch_root, where
 * /dev, /run and /proc were moved away: every path (/dev/fb0, the control file ...) would fail from then on. So it keeps a
 * descriptor of the /proc mount (which moves along) and, as soon as PID 1 has a different root, chroots into it. */
static int enter_real_root(int procfd) {
    if (procfd < 0) return 0;
    int fd = openat(procfd, "1/root", O_RDONLY | O_DIRECTORY | O_CLOEXEC);
    if (fd < 0) return 0;
    struct stat ours, theirs;
    int different = !stat("/", &ours) && !fstat(fd, &theirs) && (ours.st_dev != theirs.st_dev || ours.st_ino != theirs.st_ino);
    int ok = different && fchdir(fd) == 0 && chroot(".") == 0 && chdir("/") == 0;
    close(fd);
    return different ? (ok ? 1 : -1) : 0;
}
static void create_control(const char *path) { /* an empty control file anybody may write to */
    if (!path) return;
    mode_t old = umask(0);
    int fd = open(path, O_WRONLY | O_CREAT | O_TRUNC | O_CLOEXEC, 0666);
    umask(old);
    if (fd >= 0) close(fd);
}
static void write_pid_file(const char *path) {
    if (!path) return;
    FILE *f = fopen(path, "w");
    if (f) { fprintf(f, "%d\n", (int)getpid()); fclose(f); }
}

static int run_daemon(const Options *o) {
    struct sigaction sa;
    memset(&sa, 0, sizeof sa);
    sa.sa_handler = on_signal;
    sigaction(SIGUSR1, &sa, NULL); sigaction(SIGTERM, &sa, NULL); sigaction(SIGINT, &sa, NULL); sigaction(SIGHUP, &sa, NULL);
    signal(SIGPIPE, SIG_IGN);
    create_control(o->control);
    int procfd = open("/proc", O_RDONLY | O_DIRECTORY | O_CLOEXEC), in_real_root = 0;
    Display display = {.fd = -1};
    Scene scene;
    memset(&scene, 0, sizeof scene);
    int inputs[MAX_INPUTS], input_count = 0;
    char input_names[MAX_INPUTS][32], message[96] = "";
    event_log = fopen("/run/devos-splash.log", "a");
    event_start = now_seconds();
    double start = now_seconds(), next_frame = start, next_check = start, fade_out_at = -1;
    int graphics = 0, full = 1, last_dx = 0, last_dy = 0, reveal = 0;
    while (!reveal) {
        double now = now_seconds(), t = now - start;
        if (!in_real_root && now >= next_check) {
            int moved = enter_real_root(procfd);
            if (moved) { /* the control and pid files must exist in the root clients see */
                note("switch_root seen: %s the real root", moved > 0 ? "entered" : "could not enter");
                in_real_root = moved > 0;
                if (o->control && access(o->control, F_OK)) create_control(o->control);
                if (o->pid && access(o->pid, F_OK)) write_pid_file(o->pid);
                if (display.fd >= 0) { display_close(&display); scene_free(&scene); }
                next_check = now;
            }
        }
        control_poll(o->control);
        if (signal_quit == 2 || (o->timeout > 0 && t > o->timeout)) break;
        if (signal_quit == 1 && fade_out_at < 0) fade_out_at = t;
        if (now >= next_check) {
            next_check = now + .5;
            if (display.fd >= 0 && display_changed(&display, o->fb)) { /* simpledrm is replaced by msm: fb0 vanishes, a new one appears later */
                note("framebuffer gone or changed (was %s %ux%u)", (char *)display.fix.id, display.var.xres, display.var.yres);
                display_close(&display); scene_free(&scene);
            }
            if (display.fd < 0 && display_open(&display, o->fb) == 0) {
                if (scene_init(&scene, display.var.xres, display.var.yres, o->message)) display_close(&display);
                else { note("framebuffer %s %ux%u %ubpp line %u", (char *)display.fix.id, display.var.xres, display.var.yres, display.var.bits_per_pixel, display.fix.line_length); full = 1; if (!graphics) graphics = tty_hide(o->tty) == 0; }
            }
            if (display.fd >= 0) full = 1; /* twice a second repaint everything: fbcon may have cleared the screen meanwhile */
            if (display.fd >= 0 && o->status && read_status(o->status, message, sizeof message)) { scene_set_message(&scene, message); full = 1; }
            input_count = open_inputs(inputs, input_count, input_names);
            if (display.fd < 0 && !graphics && t > 40) break; /* no framebuffer ever appeared: leave the text console alone */
        }
        if (display.fd >= 0) {
            float fade = ease((float)t / FADE_IN);
            if (fade_out_at >= 0) fade *= 1 - ease((float)(t - fade_out_at) / FADE_OUT);
            int dx = (int)lroundf(10 * scene.unit * sinf(TAU * (float)fmod(t, 97) / 97)), dy = (int)lroundf(8 * scene.unit * sinf(TAU * (float)fmod(t, 131) / 131));
            if (dx != last_dx || dy != last_dy) { last_dx = dx; last_dy = dy; full = 1; } /* burn-in drift; the region margins are black */
            int ox = ((int)display.var.xres - scene.width) / 2 + dx, oy = ((int)display.var.yres - scene.height) / 2 + dy;
            int x0 = 0, y0 = 0, x1 = scene.width, y1 = scene.height;
            if (!full && fade >= .999f) arc_rect(&scene, &x0, &y0, &x1, &y1);
            scene_compose(&scene, (float)t, x0, y0, x1, y1);
            scale_region(&scene, x0, y0, x1, y1, fade);
            display_present(&display, &scene, ox, oy, x0, y0, x1, y1);
            full = fade < .999f;
        }
        if (fade_out_at >= 0 && t - fade_out_at >= FADE_OUT) break;
        next_frame += 1.0 / FPS;
        if (next_frame < now) next_frame = now + 1.0 / FPS;
        struct pollfd fds[MAX_INPUTS];
        for (int i = 0; i < input_count; i++) { fds[i].fd = inputs[i]; fds[i].events = POLLIN; fds[i].revents = 0; }
        int wait = (int)ceil((next_frame - now_seconds()) * 1000);
        if (poll(fds, input_count, wait < 0 ? 0 : wait) > 0)
            for (int i = 0; i < input_count; i++) {
                struct input_event ev;
                if (!(fds[i].revents & POLLIN)) continue;
                while (read(inputs[i], &ev, sizeof ev) == sizeof ev)
                    if (ev.type == EV_KEY && ev.value == 1 && ev.code == KEY_ESC && t > 1.0) { note("Esc pressed"); reveal = 1; } /* only Esc: stray EC/backlight/power keys must not end the animation */
                    else if (ev.type == EV_KEY && ev.value == 1) note("ignored key %d", ev.code);
            }
    }
    note("leaving: quit=%d reveal=%d t=%.1f graphics=%d display=%d", (int)signal_quit, reveal, t_end(start), graphics, display.fd >= 0);
    int quiet = fade_out_at >= 0 && signal_quit != 2 && !reveal;
    if (display.fd >= 0 && quiet) memset(display.map, 0, display.length);
    if (graphics) tty_show(o->tty, quiet || reveal); /* a quiet exit leaves a blank console, a text exit keeps what is there */
    if (reveal) tty_write(o->tty, "Dev OS: boot animation stopped (Esc).\n");
    if (reveal && access("/run/systemd/system", F_OK) == 0) kill(1, SIGRTMIN + 20); /* systemd as PID 1: show boot status again */
    for (int i = 0; i < input_count; i++) close(inputs[i]);
    display_close(&display);
    scene_free(&scene);
    if (o->pid) unlink(o->pid);
    if (o->control) unlink(o->control);
    return 0;
}

static void usage(void) { fputs("usage: devos-splash --daemon | --quit [--text] | --dump DIR [options]\n", stderr); }

int main(int argc, char **argv) {
    Options o = {.fb = "/dev/fb0", .tty = "/dev/tty0", .pid = "/run/devos-splash.pid", .status = "/run/devos-splash.status", .control = "/run/devos-splash.ctl",
                 .message = "Starting Dev OS", .frames = 144, .width = 1280, .height = 720};
    for (int i = 1; i < argc; i++) {
        const char *a = argv[i], *v = i + 1 < argc ? argv[i + 1] : NULL;
        if (!strcmp(a, "--daemon")) o.daemon = 1;
        else if (!strcmp(a, "--quit")) o.quit = 1;
        else if (!strcmp(a, "--text")) o.text = 1;
        else if (!strcmp(a, "--fade")) o.fade = 1;
        else if (!strcmp(a, "--full")) o.full = 1;
        else if (v && !strcmp(a, "--fb")) { o.fb = v; i++; }
        else if (v && !strcmp(a, "--tty")) { o.tty = v; i++; }
        else if (v && !strcmp(a, "--pid")) { o.pid = v; i++; }
        else if (v && !strcmp(a, "--status")) { o.status = v; i++; }
        else if (v && !strcmp(a, "--control")) { o.control = v; i++; }
        else if (v && !strcmp(a, "--message")) { o.message = v; i++; }
        else if (v && !strcmp(a, "--timeout")) { o.timeout = atof(v); i++; }
        else if (v && !strcmp(a, "--dump")) { o.dump = v; i++; }
        else if (v && !strcmp(a, "--frames")) { o.frames = atoi(v); i++; }
        else if (v && !strcmp(a, "--size")) { if (sscanf(v, "%dx%d", &o.width, &o.height) != 2) { usage(); return 2; } i++; }
        else { usage(); return 2; }
    }
    if (o.dump) return dump_frames(&o);
    if (o.quit) return client_quit(&o);
    if (!o.daemon) { usage(); return 2; }
    FILE *running = fopen(o.pid, "r");
    int other = 0;
    if (running) { if (fscanf(running, "%d", &other) == 1 && other > 1 && kill(other, 0) == 0) { fclose(running); return 0; } fclose(running); }
    pid_t child = fork();
    if (child < 0) return 1;
    if (child > 0) { /* the parent returns at once so the boot script is never held up */
        char tmp[256];
        snprintf(tmp, sizeof tmp, "%s.%d", o.pid, (int)child);
        FILE *f = fopen(tmp, "w");
        if (f) { fprintf(f, "%d\n", (int)child); fclose(f); rename(tmp, o.pid); }
        return 0;
    }
    setsid();
    int null = open("/dev/null", O_RDWR);
    if (null >= 0) { dup2(null, 0); dup2(null, 1); dup2(null, 2); if (null > 2) close(null); }
    if (chdir("/") != 0) { /* the working directory does not matter */ }
    return run_daemon(&o);
}
