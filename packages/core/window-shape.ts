import Cairo from 'cairo';

/** Conservative opaque interior: exclude the antialiased edge and all corners.
 * This lets software compositors skip pixels behind an opaque rounded window. */
export function roundedOpaqueRegion(x: number, y: number, width: number, height: number, radius: number, opaque: boolean) {
    const region = new Cairo.Region();
    if (!opaque) return region;
    const inset = Math.max(1, Math.ceil(radius) + 1);
    if (width > 2 * inset && height > 2) region.unionRectangle({x: x + inset, y: y + 1, width: width - 2 * inset, height: height - 2});
    if (height > 2 * inset && width > 2) region.unionRectangle({x: x + 1, y: y + inset, width: width - 2, height: height - 2 * inset});
    return region;
}
