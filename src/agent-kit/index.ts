export interface AgentKitPluginSelection {
  profileName: string;
  plugins: string[];
  allowedActions: string[];
}

export interface ActionFilterRule {
  actionName: string;
  enabled: boolean;
  reason?: string;
}

export function definePluginSelection(
  selection: AgentKitPluginSelection
): AgentKitPluginSelection {
  return selection;
}
