ALTER TABLE "tournaments" ADD COLUMN "win_points" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "tournaments" ADD COLUMN "draw_points" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "tournaments" ADD COLUMN "loss_points" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tournaments" ADD COLUMN "tiebreaker_order" text;