self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "Keepr", body: "Open Keepr to view the latest update." };
  }

  const title = payload.title || "Keepr";
  const options = {
    body: payload.body || "Open Keepr to view the latest update.",
    icon: payload.icon || "/android-chrome-192.png",
    badge: payload.badge || "/favicon-32.png",
    data: payload.data || { url: "/" },
    tag: payload.tag || payload.data?.threadId || payload.data?.actionId || "keepr-notification",
    renotify: false,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const absoluteUrl = new URL(targetUrl, self.location.origin).href;
      for (const client of clients) {
        if ("focus" in client && client.url === absoluteUrl) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(absoluteUrl);
      return null;
    })
  );
});
