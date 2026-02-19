/**
 * Frontend entrypoint that mounts the root React application.
 *
 * This module wires global CSS and renders the `App` shell.
 */
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./App.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
