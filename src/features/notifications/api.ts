import { queryOptions } from "@tanstack/react-query"
import { createServerFn } from "@tanstack/react-start"
import { z } from "zod"
import { authed } from "@/server/middleware"
import { listNotifications, markRead, serializeNotification, unreadCount } from "@/server/services/notifications"

export const fetchNotifications = createServerFn({ method: "GET" })
  .middleware([authed])
  .handler(({ context: { actor } }) => ({
    items: listNotifications(actor.id).map(serializeNotification),
    unread: unreadCount(actor.id),
  }))

export const markNotificationsRead = createServerFn({ method: "POST" })
  .middleware([authed])
  .validator(z.object({ ids: z.array(z.number().int()).max(500).nullable() }))
  .handler(({ data, context: { actor } }) => ({ changed: markRead(actor.id, data.ids) }))

export const notificationsQuery = queryOptions({
  queryKey: ["notifications"],
  queryFn: () => fetchNotifications(),
})
