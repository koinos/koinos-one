import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { DashboardPanel } from './DashboardPanel'

const translations: Record<string, string> = {
  'dashboard.panelAria': 'Dashboard',
  'dashboard.subtabsAria': 'Dashboard subtabs',
  'dashboard.subtab.producers': 'Producers',
  'dashboard.subtab.peers': 'Peers',
  'dashboard.subtab.forecast': 'Forecast',
  'dashboard.subtab.performance': 'Performance',
  'dashboard.performance.telenoCpu': 'Teleno UX CPU',
  'dashboard.performance.telenoRam': 'Teleno UX RAM',
  'dashboard.performance.servicesCpu': 'Node CPU',
  'dashboard.performance.servicesRam': 'Node RAM',
  'dashboard.performance.freeSystemRam': 'Free system RAM',
  'dashboard.performance.freeDisk': 'Disk Space',
  'dashboard.performance.blockchainData': 'Blockchain Data',
  'dashboard.performance.lastSample': 'Last sample',
  'dashboard.performance.hostUptime': 'Host uptime',
  'dashboard.performance.hostCpus': 'Host CPUs',
  'dashboard.performanceTitle': 'Performance',
  'dashboard.performanceDescription': 'Real-time CPU and memory snapshots for Teleno UX and the managed node process.',
  'dashboard.performanceHostSummary': 'Host summary',
  'dashboard.noPerformance': 'No performance snapshot is available yet.',
  'dashboard.col.name': 'Name',
  'dashboard.col.kind': 'Kind',
  'dashboard.col.pid': 'PID',
  'dashboard.col.cpuPercent': 'CPU %',
  'dashboard.col.ram': 'RAM',
  'dashboard.col.virtual': 'Virtual',
  'dashboard.col.uptime': 'Uptime',
  'dashboard.col.state': 'State',
  'dashboard.kind.teleno': 'Teleno UX',
  'dashboard.kind.service': 'Component',
  'common.na': 'N/A',
  'common.loading': 'Loading...'
}

function t(key: string): string {
  return translations[key] ?? key
}

describe('DashboardPanel', () => {
  it('renders the performance subtab rows and summary cards', () => {
    const html = renderToStaticMarkup(
      <DashboardPanel
        t={t}
        locale="en-US"
        hasNodeControls
        dashboardSubtab="performance"
        setDashboardSubtab={vi.fn()}
        dashboardProducerWindowBlocks={200}
        dashboardProducers={null}
        dashboardProducersLoading={false}
        dashboardProducersError={null}
        dashboardPeers={null}
        dashboardPeersLoading={false}
        dashboardPeersError={null}
        dashboardPerformance={{
          ok: true,
          output: 'Sampled 3 processes.',
          sampledAt: Date.parse('2026-03-12T11:22:33Z'),
          host: {
            cpuCount: 8,
            totalMemoryBytes: 16 * 1024 * 1024 * 1024,
            freeMemoryBytes: 6 * 1024 * 1024 * 1024,
            loadAverage: [0.25, 0.5, 0.75],
            uptimeSeconds: 3661,
            freeDiskBytes: 128 * 1024 * 1024 * 1024,
            totalDiskBytes: 512 * 1024 * 1024 * 1024,
            blockchainDataBytes: 84 * 1024 * 1024 * 1024,
            blockchainDataPath: '/tmp/.teleno'
          },
          totals: {
            telenoCpuPercent: 12.5,
            telenoMemoryBytes: 512 * 1024 * 1024,
            servicesCpuPercent: 6.25,
            servicesMemoryBytes: 256 * 1024 * 1024
          },
          rows: [
            {
              id: 'teleno:1',
              label: 'Teleno UX Main',
              kind: 'teleno',
              serviceId: null,
              pid: 111,
              cpuPercent: 12.5,
              rssBytes: 512 * 1024 * 1024,
              virtualBytes: null,
              uptimeSeconds: 600,
              state: 'Browser',
              command: '/Applications/Teleno UX.app',
              managedByTeleno: true
            },
            {
              id: 'service:indexer',
              label: 'Indexer',
              kind: 'service',
              serviceId: 'indexer',
              pid: 222,
              cpuPercent: 6.25,
              rssBytes: 256 * 1024 * 1024,
              virtualBytes: 1024 * 1024 * 1024,
              uptimeSeconds: 300,
              state: 'S',
              command: '/usr/local/bin/indexer',
              managedByTeleno: true
            }
          ]
        }}
        dashboardPerformanceLoading={false}
        dashboardPerformanceError={null}
        nodeProducerOverview={null}
        nodeProducerLoading={false}
        nodeProducerError={null}
      />
    )

    expect(html).toContain('Teleno UX CPU')
    expect(html).toContain('Performance')
    expect(html).toContain('Indexer')
    expect(html).toContain('Component')
    expect(html).toContain('Blockchain Data')
    expect(html).toContain('84 GB')
    expect(html).toContain('12.5%')
    expect(html).toContain('512 MB')
    expect(html).toContain('1 GB')
  })
})
