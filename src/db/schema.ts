import {
  pgTable,
  uuid,
  varchar,
  integer,
  timestamp,
  unique,
  boolean,
  index,
} from "drizzle-orm/pg-core";

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    email: varchar("email", {
      length: 255,
    }).unique(),

    freeDownloadsUsed: integer("free_downloads_used").notNull().default(0),

    isPaid: boolean("is_paid").notNull().default(false),

    creemCustomerId: varchar("creem_customer_id", {
      length: 255,
    }),

    creemSubscriptionId: varchar("creem_subscription_id", {
      length: 255,
    }),

    paidAt: timestamp("paid_at", {
      withTimezone: true,
    }),

    lastSeenAt: timestamp("last_seen_at", {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),

    createdAt: timestamp("created_at", {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),

    updatedAt: timestamp("updated_at", {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    emailIdx: index("users_email_idx").on(table.email),
    creemCustomerIdIdx: index("users_creem_customer_id_idx").on(
      table.creemCustomerId,
    ),
    creemSubscriptionIdIdx: index("users_creem_subscription_id_idx").on(
      table.creemSubscriptionId,
    ),
  }),
);

export const installations = pgTable(
  "installations",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "cascade",
      }),

    installationId: varchar("installation_id", {
      length: 128,
    })
      .notNull()
      .unique(),

    lastSeenAt: timestamp("last_seen_at", {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),

    createdAt: timestamp("created_at", {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),

    updatedAt: timestamp("updated_at", {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    userIdIdx: index("installations_user_id_idx").on(table.userId),
    installationIdIdx: index("installations_installation_id_idx").on(
      table.installationId,
    ),
  }),
);

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    userId: uuid("user_id")
      .notNull()
      .unique()
      .references(() => users.id, {
        onDelete: "cascade",
      }),

    creemCustomerId: varchar("creem_customer_id", {
      length: 255,
    }),

    creemSubscriptionId: varchar("creem_subscription_id", {
      length: 255,
    }).unique(),

    creemProductId: varchar("creem_product_id", {
      length: 255,
    }),

    status: varchar("status", {
      length: 50,
    })
      .notNull()
      .default("inactive"),

    currentPeriodStart: timestamp("current_period_start", {
      withTimezone: true,
    }),

    currentPeriodEnd: timestamp("current_period_end", {
      withTimezone: true,
    }),

    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),

    createdAt: timestamp("created_at", {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),

    updatedAt: timestamp("updated_at", {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    userIdIdx: index("subscriptions_user_id_idx").on(table.userId),
    creemCustomerIdIdx: index("subscriptions_creem_customer_id_idx").on(
      table.creemCustomerId,
    ),
    creemSubscriptionIdIdx: index("subscriptions_creem_subscription_id_idx").on(
      table.creemSubscriptionId,
    ),
  }),
);

export const downloads = pgTable(
  "downloads",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    taskId: varchar("task_id", {
      length: 128,
    }).notNull(),

    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "cascade",
      }),

    previewUrl: varchar("preview_url", {
      length: 2048,
    }),

    modelUrl: varchar("model_url", {
      length: 2048,
    }),

    createdAt: timestamp("created_at", {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    userTaskUnique: unique("downloads_user_task_unique").on(
      table.userId,
      table.taskId,
    ),
    userIdIdx: index("downloads_user_id_idx").on(table.userId),
    taskIdIdx: index("downloads_task_id_idx").on(table.taskId),
  }),
);
