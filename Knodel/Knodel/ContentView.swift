import SwiftUI

enum AppTab: String, CaseIterable, Identifiable {
    case explorer = "Explorer"
    case node = "Node"

    var id: String { rawValue }
}

struct ContentView: View {
    @EnvironmentObject var settingsVM: SettingsViewModel
    @StateObject private var explorerVM = BlockExplorerViewModel()
    @StateObject private var nodeVM = NodeManagerViewModel()
    @State private var selectedTab: AppTab = .explorer

    var body: some View {
        VStack(spacing: 0) {
            headerBar
            Divider()
            tabContent
        }
        .background(.background)
        .onReceive(NotificationCenter.default.publisher(for: .switchTab)) { notification in
            if let tab = notification.object as? AppTab {
                selectedTab = tab
            }
        }
        .onAppear {
            explorerVM.configure(with: settingsVM)
            nodeVM.configure(with: settingsVM)
        }
        .onChange(of: settingsVM.explorerSettings) {
            explorerVM.configure(with: settingsVM)
        }
        .onChange(of: settingsVM.nodeSettings) {
            nodeVM.configure(with: settingsVM)
        }
    }

    private var headerBar: some View {
        HStack {
            Picker("", selection: $selectedTab) {
                ForEach(AppTab.allCases) { tab in
                    Text(tab.rawValue).tag(tab)
                }
            }
            .pickerStyle(.segmented)
            .frame(width: 200)

            Spacer()

            StatusPillView(
                status: statusForCurrentTab,
                text: statusTextForCurrentTab
            )
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
    }

    @ViewBuilder
    private var tabContent: some View {
        switch selectedTab {
        case .explorer:
            BlockExplorerView()
                .environmentObject(explorerVM)
        case .node:
            NodeManagerView()
                .environmentObject(nodeVM)
                .environmentObject(settingsVM)
        }
    }

    private var statusForCurrentTab: StatusPillView.Status {
        switch selectedTab {
        case .explorer:
            if explorerVM.errorMessage != nil { return .error }
            return .live
        case .node:
            if nodeVM.errorMessage != nil { return .error }
            if nodeVM.runningCount > 0 { return .live }
            return .idle
        }
    }

    private var statusTextForCurrentTab: String {
        switch selectedTab {
        case .explorer:
            if let error = explorerVM.errorMessage {
                return "RPC Error: \(error)"
            }
            if explorerVM.isInitialLoading {
                return "Connecting to Koinos RPC..."
            }
            return "Live - \(explorerVM.blocks.count) blocks"
        case .node:
            return nodeVM.statusText
        }
    }
}
