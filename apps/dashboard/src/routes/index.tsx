import { createFileRoute } from "@tanstack/react-router";
import { Dashboard } from "../components/dashboard.js";

export const Route = createFileRoute("/")({ component: Dashboard });
