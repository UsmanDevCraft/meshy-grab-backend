import {
  pgTable,
  uuid,
  varchar,
  integer,
  timestamp,
  unique,
  boolean,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),

  email: varchar("email", {
    length: 255,
  }).unique(),

  freeDownloadsUsed: integer("free_downloads_used").notNull().default(0),

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
});

export const installations = pgTable("installations", {
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
});

export const subscriptions = pgTable("subscriptions", {
  id: uuid("id").defaultRandom().primaryKey(),

  userId: uuid("user_id")
    .notNull()
    .unique()
    .references(() => users.id, {
      onDelete: "cascade",
    }),

  stripeCustomerId: varchar("stripe_customer_id", {
    length: 255,
  }),

  stripeSubscriptionId: varchar("stripe_subscription_id", {
    length: 255,
  }).unique(),

  stripePriceId: varchar("stripe_price_id", {
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
});

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
  }),
);
