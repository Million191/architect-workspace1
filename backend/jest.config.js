/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.ts'],
  // The jsdom page journeys (real page scripts + real Express app) run several seconds when the whole
  // suite shares the CPU; the 5s default made them fail intermittently under load. Their own waitFor
  // helpers still fail fast (8s) with a named step when something is actually wrong.
  testTimeout: 20000,
};
