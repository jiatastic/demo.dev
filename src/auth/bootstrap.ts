import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { chromium, type Locator, type Page } from "playwright";
import type { ActionTarget } from "../types.js";
import type { ProjectAuthConfig } from "../config/project.js";

export interface BootstrapAuthOptions {
  baseUrl: string;
  email: string;
  password: string;
  outputPath: string;
  auth?: ProjectAuthConfig;
}

const resolveLocator = (page: Page, target: ActionTarget): Locator => {
  switch (target.strategy) {
    case "label":
      return page.getByLabel(target.value, { exact: target.exact });
    case "text":
      return page.getByText(target.value, { exact: target.exact });
    case "placeholder":
      return page.getByPlaceholder(target.value, { exact: target.exact });
    case "testId":
      return page.getByTestId(target.value);
    case "css":
      return page.locator(target.value);
    case "role":
      return page.getByRole(target.role as never, {
        name: target.name,
        exact: target.exact,
      });
  }
};

export const bootstrapAuth = async (options: BootstrapAuthOptions) => {
  const browser = await chromium.launch({ headless: true });
  const auth = options.auth;
  const loginPath = auth?.loginPath ?? "/login";
  const emailTarget: ActionTarget = auth?.emailTarget ?? { strategy: "css", value: "#email" };
  const passwordTarget: ActionTarget = auth?.passwordTarget ?? { strategy: "css", value: "#password" };
  const submitTarget: ActionTarget = auth?.submitTarget ?? { strategy: "role", role: "button", name: "Login" };

  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(new URL(loginPath, options.baseUrl).toString(), { waitUntil: "networkidle" });

    await resolveLocator(page, emailTarget).first().fill(options.email);
    await resolveLocator(page, passwordTarget).first().fill(options.password);
    await resolveLocator(page, submitTarget).first().click();

    await page.waitForLoadState("networkidle").catch(() => undefined);
    await page.waitForTimeout(auth?.postSubmitWaitMs ?? 1200);

    if (auth?.successUrlPattern) {
      await page.waitForURL(auth.successUrlPattern, { timeout: 15000 });
    } else {
      await page.waitForURL((url) => !url.toString().includes(loginPath), { timeout: 15000 });
    }

    await mkdir(dirname(options.outputPath), { recursive: true });
    await context.storageState({ path: options.outputPath });

    return {
      storageStatePath: options.outputPath,
      url: page.url(),
      title: await page.title(),
    };
  } finally {
    await browser.close();
  }
};
