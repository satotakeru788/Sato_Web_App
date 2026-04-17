import React from "react";
import ReactDOM from "react-dom/client";
import { registerSW } from "virtual:pwa-register";

import { Authenticator } from "@aws-amplify/ui-react";

import App from "./App.tsx";
import "./index.css";
import { Amplify } from "aws-amplify";
import outputs from "../amplify_outputs.json";
import { GoalProvider } from "./context/GoalContext";

import "@aws-amplify/ui-react/styles.css";

registerSW({ immediate: true });

Amplify.configure(outputs);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Authenticator>
      <GoalProvider>
        <App />
      </GoalProvider>
    </Authenticator>
  </React.StrictMode>
);
