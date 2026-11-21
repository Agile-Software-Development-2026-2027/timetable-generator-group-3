import "@testing-library/jest-dom/vitest";
import { configure } from "@testing-library/react";

// The default 1 s wait for findBy*/waitFor is too short on the CI runner, where
// pages that chain several fetches sometimes render after it and the test fails
// at random. 5 s only matters when an element is late; passing tests stay fast.
configure({ asyncUtilTimeout: 5000 });
