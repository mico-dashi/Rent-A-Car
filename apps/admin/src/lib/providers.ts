import "server-only";
import { paymentProvider } from "@rental/server";
import { serverEnv } from "./env";

export const provider = () => paymentProvider(serverEnv());
