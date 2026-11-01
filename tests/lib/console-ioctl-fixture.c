/* Test-only kernel boundary; production applets remain entirely DevLang. */
#define _GNU_SOURCE
#include <assert.h>
#include <dlfcn.h>
#include <errno.h>
#include <fcntl.h>
#include <linux/kd.h>
#include <linux/mtio.h>
#include <linux/loop.h>
#include <linux/fb.h>
#include <linux/vt.h>
#include <linux/fd.h>
#include <linux/rtc.h>
#include <linux/sockios.h>
#include <linux/hdreg.h>
#include <mtd/mtd-user.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <unistd.h>

int open(const char *path, int flags, ...) {
    int (*real_open)(const char *, int, ...) = dlsym(RTLD_NEXT, "open");
    mode_t mode = 0;
    if (flags & O_CREAT) { va_list ap; va_start(ap, flags); mode = va_arg(ap, int); va_end(ap); }
    if (!strcmp(path, "/dev/tty0") || !strcmp(path, "/dev/console") ||
        !strcmp(path, "/dev/loop-control") || !strcmp(path, "/dev/loop7") ||
        !strcmp(path, "/dev/tty7")) path = "/dev/null";
    return real_open(path, flags, mode);
}

int ioctl(int fd, unsigned long request, ...) {
    (void)fd;
    va_list ap; va_start(ap, request); void *arg = va_arg(ap, void *); va_end(ap);
    if (getenv("IOCTL_FAIL")) { errno = ENOTTY; return -1; }
    switch (request) {
    case HDIO_GET_32BIT: *(unsigned long *)arg = 1; break;
    case HDIO_SET_32BIT: assert((long)arg == 1); break;
    case HDIO_GETGEO: {
        struct hd_geometry *g = arg; g->heads = 16; g->sectors = 63; g->cylinders = 1024; break;
    }
    case HDIO_GET_IDENTITY: {
        unsigned char *p = arg;
        const char *name = "TEST DEVICE                             ";
        for (int i = 0; i < 40; i++) p[54 + (i ^ 1)] = name[i];
        break;
    }
    case HDIO_DRIVE_CMD: {
        unsigned char *p = arg;
        if (p[0] == WIN_SETFEATURES) {
            assert((p[2] == SETFEATURES_EN_WCACHE && p[1] == 0) ||
                   (p[2] == SETFEATURES_EN_APM && p[1] == 128) ||
                   (p[2] == 3 && p[1] == 70));
        } else if (p[0] == WIN_CHECKPOWERMODE1) p[2] = 255;
        else if (p[0] == WIN_IDENTIFY) {
            assert(p[3] == 1); memset(p + 4, 0, 512);
            const char *name = "TEST DEVICE                             ";
            for (int i = 0; i < 40; i++) p[4 + 54 + (i ^ 1)] = name[i];
            p[4 + 120] = 100;
        } else abort();
        break;
    }
    case TCGETS: case TCSETS: {
        int (*real_ioctl)(int, unsigned long, ...) = dlsym(RTLD_NEXT, "ioctl");
        return real_ioctl(fd, request, arg);
    }
    case TIOCGETD: *(int *)arg = 0; break;
    case TIOCSETD: assert(*(int *)arg == 0 || *(int *)arg == 1); break;
    case SIOCSIFENCAP: assert((long)arg == 1); break;
    case FDGETPRM: {
        struct floppy_struct *f = arg; f->sect = 18; f->head = 2; f->track = 2; break;
    }
    case FDFMTBEG: case FDFMTEND: break;
    case FDFMTTRK: {
        struct format_descr *f = arg; assert(f->head < 2 && f->track < 2); break;
    }
    case RTC_WKALM_SET: {
        struct rtc_wkalrm *r = arg;
        assert(r->enabled == 1 && r->time.tm_year == 130 && r->time.tm_mon == 0);
        assert(r->time.tm_mday == 2 && r->time.tm_hour == 3 && r->time.tm_min == 4 && r->time.tm_sec == 5); break;
    }
    case VT_GETSTATE: {
        struct vt_stat *v = arg; v->v_active = 1; v->v_state = 2; break;
    }
    case VT_OPENQRY: *(int *)arg = 7; break;
    case VT_ACTIVATE: case VT_WAITACTIVE: assert((long)arg == 1 || (long)arg == 7); break;
    case TIOCSCTTY: break;
    case FBIOGET_VSCREENINFO: {
        struct fb_var_screeninfo *v = arg;
        if (getenv("FB_IMAGE_TEST")) {
            v->xres = v->yres = v->xres_virtual = v->yres_virtual = 4;
            v->bits_per_pixel = 32;
            v->red.offset = 16; v->red.length = 8;
            v->green.offset = 8; v->green.length = 8;
            v->blue.length = 8; v->transp.offset = 24; v->transp.length = 8;
            break;
        }
        v->xres = v->xres_virtual = 640; v->yres = v->yres_virtual = 480;
        v->bits_per_pixel = 32; v->pixclock = 39721; break;
    }
    case FBIOGET_FSCREENINFO: {
        struct fb_fix_screeninfo *f = arg;
        assert(getenv("FB_IMAGE_TEST")); f->smem_len = 64;
        f->line_length = 16; f->visual = FB_VISUAL_TRUECOLOR; break;
    }
    case FBIOPUT_VSCREENINFO: {
        struct fb_var_screeninfo *v = arg;
        assert(v->xres == 800 && v->yres == 600 && v->xres_virtual == 800 && v->yres_virtual == 600);
        assert(v->bits_per_pixel == 16 && v->pixclock == 25000);
        assert(v->left_margin == 88 && v->right_margin == 40);
        assert(v->upper_margin == 23 && v->lower_margin == 1);
        assert(v->hsync_len == 128 && v->vsync_len == 4);
        assert(v->sync & FB_SYNC_HOR_HIGH_ACT); break;
    }
    case LOOP_CTL_GET_FREE: return 7;
    case LOOP_SET_FD: assert((long)arg >= 3); break;
    case LOOP_CLR_FD: break;
    case LOOP_SET_STATUS64: {
        struct loop_info64 *i = arg;
        assert(i->lo_offset == 4096 && i->lo_flags == 0);
        assert(strstr((char *)i->lo_file_name, "/backing")); break;
    }
    case LOOP_GET_STATUS64: {
        struct loop_info64 *i = arg; i->lo_offset = 4096;
        strcpy((char *)i->lo_file_name, "/tmp/backing"); break;
    }
    case KDGKBENT: {
        struct kbentry *e = arg;
        e->kb_value = e->kb_table == 0 ? 0x100 + e->kb_index : 0x27f;
        break;
    }
    case KDSKBENT: {
        struct kbentry *e = arg;
        assert(e->kb_table == 0 && e->kb_value == 0x100 + e->kb_index);
        break;
    }
    case KDSETKEYCODE: {
        struct kbkeycode *k = arg;
        assert((k->scancode == 0x59 && k->keycode == 120) ||
               (k->scancode == 0x9c && k->keycode == 96));
        break;
    }
    case KDFONTOP: {
        struct console_font_op *f = arg;
        assert(f->op == KD_FONT_OP_SET && f->charcount == 256);
        assert(f->width == 8 && f->height == 2);
        for (unsigned i = 0; i < 256; i++) {
            assert(f->data[i * 32] == (unsigned char)i);
            assert(f->data[i * 32 + 1] == (unsigned char)(255 - i));
            for (unsigned row = 2; row < 32; row++) assert(f->data[i * 32 + row] == 0);
        }
        break;
    }
    case PIO_SCRNMAP: {
        unsigned char *p = arg;
        for (int i = 0; i < 256; i++) assert(p[i] == i);
        break;
    }
    case MTIOCTOP: {
        struct mtop *m = arg;
        assert(m->mt_op == MTFSF && m->mt_count == 3);
        break;
    }
    case MTIOCPOS: ((struct mtpos *)arg)->mt_blkno = 1234; break;
    case MEMGETINFO: {
        struct mtd_info_user *m = arg;
        m->size = 1048576; m->erasesize = 4096; break;
    }
    case MEMLOCK: {
        struct erase_info_user *r = arg;
        assert((r->start == 4096 && r->length == 8192) ||
               (r->start == 0 && r->length == 1048576));
        break;
    }
    case MEMUNLOCK: {
        struct erase_info_user *r = arg;
        assert(r->start == 0 && r->length == 1048576); break;
    }
    default: fprintf(stderr, "unexpected ioctl: %lx\n", request); abort();
    }
    FILE *log = fopen(getenv("IOCTL_LOG"), "a");
    assert(log); fprintf(log, "%lx\n", request); fclose(log);
    return 0;
}
