import React from "react";
import { createInterceptor } from "@orderly.network/plugin-core";
import type { OrderlySDK } from "@orderly.network/plugin-core";
import { LocaleProvider } from "./i18n";
import { PluginWidgetWidget } from "./components/pluginWidget";
import type { OrderlyPluginOptions } from "./types/plugin";

/**
 * Register the orderly-plugin-template plugin.
 * Intercepts a target component and injects custom UI.
 */
export function registerOrderlyPlugin(options: OrderlyPluginOptions = {}) {
  return (SDK: OrderlySDK) => {
    SDK.registerPlugin({
      id: "oxbit-starter-plugin", // Replace with actual plugin ID via handlebars
      name: "OxbitStarterPlugin", // Replace with actual plugin name via handlebars
      version: "", // Replace with actual version via handlebars
      orderlyVersion: "", // Replace with actual version via handlebars

      interceptors: [
        createInterceptor(
          "Trading.OrderEntry.SubmitSection",
          (Original, props, _api) => (
            <>
              <Original {...props} />
              <LocaleProvider>
                <PluginWidgetWidget
                  className={options.className}
                  title={options.title}
                />
              </LocaleProvider>
            </>
          ),
        ),
      ],

      setup: (_api) => {
        // Non-UI logic: event subscriptions, logging, etc.
      },
    });
  };
}
