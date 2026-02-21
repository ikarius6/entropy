let enabled = true;

function timestamp(): string {
    return new Date().toISOString();
}

export const logger = {
    enable() {
        enabled = true;
    },
    disable() {
        enabled = false;
    },
    isEnabled() {
        return enabled;
    },

    log(...args: unknown[]) {
        if (enabled) console.log(`[${timestamp()}]`, ...args);
    },
    warn(...args: unknown[]) {
        if (enabled) console.warn(`[${timestamp()}]`, ...args);
    },
    error(...args: unknown[]) {
        if (enabled) console.error(`[${timestamp()}]`, ...args);
    },
};
