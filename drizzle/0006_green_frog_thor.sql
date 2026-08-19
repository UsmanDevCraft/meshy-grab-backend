CREATE INDEX "downloads_user_id_idx" ON "downloads" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "downloads_task_id_idx" ON "downloads" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "installations_user_id_idx" ON "installations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "installations_installation_id_idx" ON "installations" USING btree ("installation_id");--> statement-breakpoint
CREATE INDEX "subscriptions_user_id_idx" ON "subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "subscriptions_creem_customer_id_idx" ON "subscriptions" USING btree ("creem_customer_id");--> statement-breakpoint
CREATE INDEX "subscriptions_creem_subscription_id_idx" ON "subscriptions" USING btree ("creem_subscription_id");--> statement-breakpoint
CREATE INDEX "users_email_idx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "users_creem_customer_id_idx" ON "users" USING btree ("creem_customer_id");--> statement-breakpoint
CREATE INDEX "users_creem_subscription_id_idx" ON "users" USING btree ("creem_subscription_id");