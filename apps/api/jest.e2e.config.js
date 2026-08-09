/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ["js", "json", "ts"],
  rootDir: "test",
  testRegex: ".*\\.e2e-spec\\.ts$",
  transform: {
    "^.+\\.(t|j)s$": "ts-jest",
  },
  testEnvironment: "node",
};
