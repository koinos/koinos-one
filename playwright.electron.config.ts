import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/ui',
  timeout: 30_000,
  expect: {
    timeout: 5_000
  },
  forbidOnly: Boolean(process.env.CI),
  reporter: [['list']],
  use: {
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure'
  }
})
