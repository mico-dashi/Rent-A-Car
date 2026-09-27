import "server-only";
import { paymentProvider as build } from "@rental/server";
import { serverEnv } from "./env";

export { supabaseWebhookStore, webhookHandlers } from "@rental/server";
export const paymentProvider = () => build(serverEnv());
