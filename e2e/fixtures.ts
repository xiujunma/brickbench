/**
 * The browser tests' `test`: Playwright's, failing any test whose page breaks
 * the Content Security Policy. CI serves the build with the hosted site's
 * headers (public/_headers), so every feature a test uses is checked against
 * the policy the site will have.
 */
import { test as base } from '@playwright/test';

export { expect, type Locator, type Page } from '@playwright/test';

export const test = base.extend<{ securityPolicy: void }>({
  securityPolicy: [
    async ({ page }, use) => {
      const violations: string[] = [];
      page.on('console', (message) => {
        if (/Content Security Policy/i.test(message.text())) violations.push(message.text());
      });
      await use();
      if (violations.length > 0) throw new Error(`The page broke the Content Security Policy:\n${violations.join('\n')}`);
    },
    { auto: true },
  ],
});
