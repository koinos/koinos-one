export function isTelenoNodeBackupUtilityCommand(command: string): boolean {
  return /(?:^|\s)--backup-[A-Za-z0-9-]+(?:=|\s|$)/.test(command)
}
