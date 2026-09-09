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

    textureDownloadsUsed: integer("texture_downloads_used")
      .notNull()
      .default(0),

    isPaid: boolean("is_paid").notNull().default(false),

    plan: varchar("plan", {
      length: 50,
    }),

    paddleCustomerId: varchar("paddle_customer_id", {
      length: 255,
    }),

    paddleSubscriptionId: varchar("paddle_subscription_id", {
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
    paddleCustomerIdIdx: index("users_paddle_customer_id_idx").on(
      table.paddleCustomerId,
    ),
    paddleSubscriptionIdIdx: index("users_paddle_subscription_id_idx").on(
      table.paddleSubscriptionId,
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

    paddleCustomerId: varchar("paddle_customer_id", {
      length: 255,
    }),

    paddleSubscriptionId: varchar("paddle_subscription_id", {
      length: 255,
    }).unique(),

    paddleTransactionId: varchar("paddle_transaction_id", {
      length: 255,
    }),

    paddlePriceId: varchar("paddle_price_id", {
      length: 255,
    }),

    plan: varchar("plan", {
      length: 50,
    }),

    status: varchar("subscription_status", {
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
    paddleCustomerIdIdx: index("subscriptions_paddle_customer_id_idx").on(
      table.paddleCustomerId,
    ),
    paddleSubscriptionIdIdx: index(
      "subscriptions_paddle_subscription_id_idx",
    ).on(table.paddleSubscriptionId),
  }),
);

export const models = pgTable(
  "models",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "cascade",
      }),

    modelKey: varchar("model_key", {
      length: 128,
    }).notNull(),

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

    updatedAt: timestamp("updated_at", {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    userModelKeyUnique: unique("models_user_model_key_unique").on(
      table.userId,
      table.modelKey,
    ),
    userIdIdx: index("models_user_id_idx").on(table.userId),
    modelKeyIdx: index("models_model_key_idx").on(table.modelKey),
  }),
);

export const downloads = pgTable(
  "downloads",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "cascade",
      }),

    modelId: uuid("model_id")
      .notNull()
      .references(() => models.id, {
        onDelete: "cascade",
      }),

    downloadType: varchar("download_type", {
      length: 128,
    })
      .notNull()
      .default("glb"),

    createdAt: timestamp("created_at", {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    modelIdDownloadTypeUnique: unique(
      "downloads_model_id_download_type_unique",
    ).on(table.modelId, table.downloadType),
    userIdIdx: index("downloads_user_id_idx").on(table.userId),
    modelIdIdx: index("downloads_model_id_idx").on(table.modelId),
  }),
);
