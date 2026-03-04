import SwiftUI

struct ServiceChipView: View {
    let service: ServiceState

    private var knownService: KoinosService? {
        KoinosService(rawValue: service.service)
    }

    var body: some View {
        HStack(spacing: 6) {
            Circle()
                .fill(service.isRunning ? Color.green : Color.secondary.opacity(0.4))
                .frame(width: 8, height: 8)

            if let known = knownService {
                Image(systemName: known.sfSymbol)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }

            Text(knownService?.displayName ?? service.service)
                .font(.system(.caption, design: .monospaced))
                .lineLimit(1)

            Spacer()

            Text(service.state)
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(service.isRunning ? Color.green.opacity(0.08) : Color.secondary.opacity(0.05))
        .cornerRadius(6)
        .overlay(
            RoundedRectangle(cornerRadius: 6)
                .stroke(service.isRunning ? Color.green.opacity(0.3) : Color.secondary.opacity(0.15), lineWidth: 1)
        )
    }
}
