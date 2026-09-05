export function pluginCommandId(pluginId: string, localCommandId: string): string {
	return `${pluginId}:${localCommandId}`;
}
