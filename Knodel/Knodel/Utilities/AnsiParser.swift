import SwiftUI

enum AnsiParser {
    private static let basicColors: [Color] = [
        Color(red: 0.13, green: 0.15, blue: 0.17),  // black
        Color(red: 1.0, green: 0.42, blue: 0.42),    // red
        Color(red: 0.24, green: 0.86, blue: 0.59),   // green
        Color(red: 0.96, green: 0.70, blue: 0.36),   // yellow
        Color(red: 0.35, green: 0.66, blue: 1.0),    // blue
        Color(red: 0.85, green: 0.55, blue: 1.0),    // magenta
        Color(red: 0.35, green: 0.84, blue: 0.91),   // cyan
        Color(red: 0.85, green: 0.89, blue: 0.91),   // white
    ]

    private static let brightColors: [Color] = [
        Color(red: 0.42, green: 0.49, blue: 0.53),   // bright black
        Color(red: 1.0, green: 0.61, blue: 0.58),    // bright red
        Color(red: 0.49, green: 0.95, blue: 0.75),   // bright green
        Color(red: 1.0, green: 0.85, blue: 0.54),    // bright yellow
        Color(red: 0.56, green: 0.76, blue: 1.0),    // bright blue
        Color(red: 0.94, green: 0.72, blue: 1.0),    // bright magenta
        Color(red: 0.58, green: 0.94, blue: 0.98),   // bright cyan
        .white,                                        // bright white
    ]

    // swiftlint:disable:next force_try
    private static let ansiRegex = try! NSRegularExpression(pattern: "\u{1b}\\[([0-9;]*)m")

    static func parse(_ input: String) -> AttributedString {
        var result = AttributedString()
        var fg: Color?
        var bg: Color?
        var bold = false
        var italic = false
        var dim = false

        let nsInput = input as NSString
        let fullRange = NSRange(location: 0, length: nsInput.length)
        let matches = ansiRegex.matches(in: input, range: fullRange)

        var cursor = 0

        for match in matches {
            let matchRange = match.range

            // Add text before the escape sequence
            if matchRange.location > cursor {
                let textRange = NSRange(location: cursor, length: matchRange.location - cursor)
                let textBefore = nsInput.substring(with: textRange)
                if !textBefore.isEmpty {
                    var segment = AttributedString(textBefore)
                    applyStyle(&segment, fg: fg, bg: bg, bold: bold, italic: italic, dim: dim)
                    result.append(segment)
                }
            }

            // Parse SGR codes
            let codesStr: String
            if match.numberOfRanges > 1, match.range(at: 1).location != NSNotFound {
                codesStr = nsInput.substring(with: match.range(at: 1))
            } else {
                codesStr = ""
            }

            let codes = codesStr.split(separator: ";").compactMap { Int($0) }
            let sgrCodes = codes.isEmpty ? [0] : codes

            var i = 0
            while i < sgrCodes.count {
                let code = sgrCodes[i]
                switch code {
                case 0:
                    fg = nil; bg = nil; bold = false; italic = false; dim = false
                case 1: bold = true
                case 2: dim = true
                case 3: italic = true
                case 22: bold = false; dim = false
                case 23: italic = false
                case 30...37: fg = basicColors[code - 30]
                case 39: fg = nil
                case 40...47: bg = basicColors[code - 40]
                case 49: bg = nil
                case 90...97: fg = brightColors[code - 90]
                case 100...107: bg = brightColors[code - 100]
                case 38, 48:
                    if i + 1 < sgrCodes.count {
                        let mode = sgrCodes[i + 1]
                        if mode == 5, i + 2 < sgrCodes.count {
                            let color = xterm256Color(sgrCodes[i + 2])
                            if code == 38 { fg = color } else { bg = color }
                            i += 2
                        } else if mode == 2, i + 4 < sgrCodes.count {
                            let r = Double(min(255, max(0, sgrCodes[i + 2]))) / 255.0
                            let g = Double(min(255, max(0, sgrCodes[i + 3]))) / 255.0
                            let b = Double(min(255, max(0, sgrCodes[i + 4]))) / 255.0
                            let color = Color(red: r, green: g, blue: b)
                            if code == 38 { fg = color } else { bg = color }
                            i += 4
                        }
                    }
                default: break
                }
                i += 1
            }

            cursor = matchRange.location + matchRange.length
        }

        // Add remaining text
        if cursor < nsInput.length {
            let remaining = nsInput.substring(from: cursor)
            if !remaining.isEmpty {
                var segment = AttributedString(remaining)
                applyStyle(&segment, fg: fg, bg: bg, bold: bold, italic: italic, dim: dim)
                result.append(segment)
            }
        }

        return result
    }

    private static func applyStyle(
        _ segment: inout AttributedString,
        fg: Color?, bg: Color?,
        bold: Bool, italic: Bool, dim: Bool
    ) {
        if let fg { segment.foregroundColor = fg }
        if let bg { segment.backgroundColor = bg }
        if bold { segment.font = .system(.body, design: .monospaced).bold() }
        if italic { segment.font = (segment.font ?? .system(.body, design: .monospaced)).italic() }
        if dim { segment.foregroundColor = (fg ?? .primary).opacity(0.78) }
    }

    private static func xterm256Color(_ code: Int) -> Color {
        let c = min(255, max(0, code))
        if c < 8 { return basicColors[c] }
        if c < 16 { return brightColors[c - 8] }
        if c >= 232 {
            let level = Double(8 + (c - 232) * 10) / 255.0
            return Color(red: level, green: level, blue: level)
        }
        let n = c - 16
        let ri = n / 36
        let gi = (n % 36) / 6
        let bi = n % 6
        func ch(_ i: Int) -> Double { i == 0 ? 0 : Double(55 + i * 40) / 255.0 }
        return Color(red: ch(ri), green: ch(gi), blue: ch(bi))
    }
}
