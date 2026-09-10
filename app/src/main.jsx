import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Simple from "./Simple.jsx";
import App from "./App.jsx";
// The site is one page. The old terminal stays reachable at /legacy.
const Root = window.location.pathname.startsWith("/legacy") ? App : Simple;
createRoot(document.getElementById("root")).render(<StrictMode><Root /></StrictMode>);
