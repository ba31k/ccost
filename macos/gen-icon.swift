// Draws the ccost icon (dark rounded plate + teal bars with a phosphor
// glow) and writes an .iconset for iconutil.
// Usage: swift gen-icon.swift <outdir>
import AppKit

let outDir = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "ccost.iconset"
try? FileManager.default.createDirectory(atPath: outDir, withIntermediateDirectories: true)

func render(_ px: Int, _ name: String) {
    guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: px, pixelsHigh: px,
                                     bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
                                     isPlanar: false, colorSpaceName: .deviceRGB,
                                     bytesPerRow: 0, bitsPerPixel: 0) else { return }
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    let s = CGFloat(px)
    let inset = s * 0.09                       // standard macOS icon inset
    let rect = NSRect(x: inset, y: inset, width: s - inset * 2, height: s - inset * 2)
    let plate = NSBezierPath(roundedRect: rect, xRadius: s * 0.185, yRadius: s * 0.185)
    NSGradient(colors: [
        NSColor(srgbRed: 0.080, green: 0.101, blue: 0.128, alpha: 1),
        NSColor(srgbRed: 0.035, green: 0.045, blue: 0.060, alpha: 1),
    ])!.draw(in: plate, angle: -90)
    plate.lineWidth = max(s * 0.004, 1)
    NSColor(white: 1, alpha: 0.08).setStroke()
    plate.stroke()

    let teal = NSColor(srgbRed: 0.176, green: 0.831, blue: 0.784, alpha: 1)
    let glow = NSShadow()
    glow.shadowColor = teal.withAlphaComponent(0.55)
    glow.shadowBlurRadius = s * 0.04
    glow.set()
    teal.setFill()
    let heights: [CGFloat] = [0.26, 0.42, 0.62]
    let baseY = rect.minY + rect.height * 0.20
    let bw = rect.width * 0.13
    for (i, h) in heights.enumerated() {
        let x = rect.minX + rect.width * (0.22 + 0.22 * CGFloat(i))
        let bar = NSRect(x: x, y: baseY, width: bw, height: rect.height * h)
        NSBezierPath(roundedRect: bar, xRadius: bw * 0.25, yRadius: bw * 0.25).fill()
    }
    NSGraphicsContext.restoreGraphicsState()
    if let png = rep.representation(using: .png, properties: [:]) {
        try? png.write(to: URL(fileURLWithPath: outDir + "/" + name))
    }
}

for (px, name) in [
    (16, "icon_16x16.png"), (32, "icon_16x16@2x.png"),
    (32, "icon_32x32.png"), (64, "icon_32x32@2x.png"),
    (128, "icon_128x128.png"), (256, "icon_128x128@2x.png"),
    (256, "icon_256x256.png"), (512, "icon_256x256@2x.png"),
    (512, "icon_512x512.png"), (1024, "icon_512x512@2x.png"),
] { render(px, name) }
print("icons: \(outDir)")
