import SwiftUI

struct ConfigEditorView: View {
    let filePath: String
    @State private var content: String = ""
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var lastSavedAt: Date?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()

            if isLoading {
                Spacer()
                ProgressView("Loading...")
                Spacer()
            } else {
                TextEditor(text: $content)
                    .font(.system(.body, design: .monospaced))
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }

            if let error = errorMessage {
                HStack {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundStyle(.yellow)
                    Text(error)
                        .font(.caption)
                    Spacer()
                }
                .padding(8)
                .background(.red.opacity(0.1))
            }
        }
        .frame(minWidth: 600, minHeight: 400)
        .onAppear { loadFile() }
    }

    private var header: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text("Config Editor")
                    .font(.headline)
                Text(filePath)
                    .font(.caption)
                    .fontDesign(.monospaced)
                    .foregroundStyle(.secondary)
            }

            Spacer()

            if let saved = lastSavedAt {
                Text("Saved \(saved.formatted(date: .omitted, time: .standard))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Button("Reload") { loadFile() }
            Button("Save") { saveFile() }
                .buttonStyle(.borderedProminent)
            Button("Close") { dismiss() }
        }
        .padding(12)
    }

    private func loadFile() {
        isLoading = true
        errorMessage = nil
        do {
            content = try String(contentsOfFile: filePath, encoding: .utf8)
        } catch {
            errorMessage = "Could not load file: \(error.localizedDescription)"
            content = ""
        }
        isLoading = false
    }

    private func saveFile() {
        errorMessage = nil
        do {
            try content.write(toFile: filePath, atomically: true, encoding: .utf8)
            lastSavedAt = Date()
        } catch {
            errorMessage = "Could not save file: \(error.localizedDescription)"
        }
    }
}
