import SwiftUI

struct ServiceListView: View {
    let services: [ServiceState]
    let onShowLogs: (String) -> Void

    private let columns = [GridItem(.adaptive(minimum: 150, maximum: 200), spacing: 8)]

    var body: some View {
        LazyVGrid(columns: columns, spacing: 8) {
            ForEach(services) { service in
                ServiceChipView(service: service)
                    .contextMenu {
                        Button("Show Logs") {
                            onShowLogs(service.service)
                        }
                    }
                    .onTapGesture(count: 2) {
                        onShowLogs(service.service)
                    }
            }
        }
    }
}
