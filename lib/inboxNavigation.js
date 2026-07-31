let lastInboxMode = "actions";

export const INBOX_MODES = {
  ACTIONS: "actions",
  MESSAGES: "messages",
};

export function normalizeInboxMode(mode) {
  return mode === INBOX_MODES.MESSAGES ? INBOX_MODES.MESSAGES : INBOX_MODES.ACTIONS;
}

export function setLastInboxMode(mode) {
  lastInboxMode = normalizeInboxMode(mode);
}

export function getLastInboxMode() {
  return lastInboxMode;
}

export function navigateToInbox(navigation, mode, params = {}) {
  if (!navigation?.navigate) return;
  const nextMode = normalizeInboxMode(mode || lastInboxMode);
  setLastInboxMode(nextMode);
  const routeNames = navigation.getState?.()?.routeNames || [];
  const canNavigateDirectly = (name) => Array.isArray(routeNames) && routeNames.includes(name);
  const isRootNavigator = canNavigateDirectly("RootTabs");

  if (nextMode === INBOX_MODES.MESSAGES) {
    const messageParams = {
      scope: "global",
      inboxMode: INBOX_MODES.MESSAGES,
      ...(params || {}),
    };
    if (!isRootNavigator && canNavigateDirectly("Messages")) {
      navigation.navigate("Messages", messageParams);
    } else {
      navigation.navigate("RootTabs", {
        screen: "Messages",
        params: messageParams,
      });
    }
    return;
  }

  const notificationParams = {
    screen: "InboxHome",
    params: {
      inboxMode: INBOX_MODES.ACTIONS,
      ...(params || {}),
    },
  };
  if (!isRootNavigator && canNavigateDirectly("Notifications")) {
    navigation.navigate("Notifications", notificationParams);
  } else {
    navigation.navigate("RootTabs", {
      screen: "Notifications",
      params: notificationParams,
    });
  }
}
