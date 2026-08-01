import { createFileRoute } from "@tanstack/react-router";
import { AssetsPage } from "../components/assets.js";

export const Route = createFileRoute("/")({ component: AssetsPage });
