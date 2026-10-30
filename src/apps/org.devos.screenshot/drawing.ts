import Cairo from 'cairo';
import Gdk from 'gi://Gdk?version=3.0';
import type GdkPixbuf from 'gi://GdkPixbuf?version=2.0';
import type {Point} from './geometry.js';
export type Tool = 'pen' | 'highlighter';
export interface Stroke {tool: Tool; color: [number, number, number]; width: number; points: Point[];}
export const PALETTE: readonly {name: string; rgb: [number, number, number]}[] = [
    {name: 'Red', rgb: [0.92, 0.26, 0.21]}, {name: 'Yellow', rgb: [1, 0.85, 0.1]}, {name: 'Green', rgb: [0.2, 0.75, 0.35]},
    {name: 'Blue', rgb: [0.2, 0.5, 0.95]}, {name: 'Black', rgb: [0.05, 0.05, 0.05]}, {name: 'White', rgb: [1, 1, 1]},
];
/** Draws the strokes the way both the canvas and the exported image show them (highlighter is translucent and wider). */
export function drawStrokes(cr: Cairo.Context, strokes: readonly Stroke[]): void {
    for (const stroke of strokes) {
        if (stroke.points.length < 1) continue;
        cr.setSourceRGBA(stroke.color[0], stroke.color[1], stroke.color[2], stroke.tool === 'highlighter' ? 0.4 : 1);
        cr.setLineWidth(stroke.tool === 'highlighter' ? stroke.width * 4 : stroke.width);
        cr.setLineCap(stroke.tool === 'highlighter' ? Cairo.LineCap.SQUARE : Cairo.LineCap.ROUND); cr.setLineJoin(Cairo.LineJoin.ROUND);
        stroke.points.forEach((point, index) => { if (index === 0) cr.moveTo(point.x, point.y); else cr.lineTo(point.x, point.y); });
        if (stroke.points.length === 1) cr.lineTo(stroke.points[0]!.x + 0.01, stroke.points[0]!.y);
        cr.stroke();
    }
}
/** The snip with its annotations burnt in. */
export function renderAnnotated(pixbuf: GdkPixbuf.Pixbuf, strokes: readonly Stroke[]): GdkPixbuf.Pixbuf {
    if (!strokes.length) return pixbuf;
    const width = pixbuf.get_width(), height = pixbuf.get_height();
    const surface = new Cairo.ImageSurface(Cairo.Format.ARGB32, width, height), cr = new Cairo.Context(surface);
    Gdk.cairo_set_source_pixbuf(cr, pixbuf, 0, 0); cr.paint(); drawStrokes(cr, strokes);
    const result = Gdk.pixbuf_get_from_surface(surface, 0, 0, width, height)!;
    cr.$dispose();
    return result;
}

