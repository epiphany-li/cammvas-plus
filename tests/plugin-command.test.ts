import { describe, expect, it } from "vitest";
import { pluginCommandId } from "../src/ui/plugin-command";

describe("pluginCommandId", () => {
	it("uses the installed plugin id instead of a legacy hard-coded prefix", () => {
		expect(pluginCommandId("cammvas-plus", "mindmap-add-child"))
			.toBe("cammvas-plus:mindmap-add-child");
	});
});
