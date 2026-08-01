import { createFileRoute } from "@tanstack/react-router";
import { TunnelsPage } from "../components/tunnels.js";

export const Route = createFileRoute("/tunnels")({ component: TunnelsPage });
