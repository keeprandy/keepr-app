const { withDangerousMod } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

module.exports = function withShareExtensionFix(config) {
  return withDangerousMod(config, [
    "ios",
    async (config) => {
      const plistPath = path.join(
        config.modRequest.platformProjectRoot,
        "ShareExtension",
        "ShareExtension-Info.plist"
      );

      if (!fs.existsSync(plistPath)) {
        console.warn("[withShareExtensionFix] ShareExtension plist not found:", plistPath);
        return config;
      }

      let plist = fs.readFileSync(plistPath, "utf8");

      plist = plist.replace(
        /<key>NSExtensionActivationRule<\/key>\s*<dict>[\s\S]*?<\/dict>/,
        `<key>NSExtensionActivationRule</key>
        <dict>
          <key>NSExtensionActivationSupportsText</key>
          <true/>
          <key>NSExtensionActivationSupportsWebURLWithMaxCount</key>
          <integer>1</integer>
          <key>NSExtensionActivationSupportsWebPageWithMaxCount</key>
          <integer>1</integer>
          <key>NSExtensionActivationSupportsImageWithMaxCount</key>
          <integer>10</integer>
          <key>NSExtensionActivationSupportsFileWithMaxCount</key>
          <integer>10</integer>
        </dict>`
      );

      fs.writeFileSync(plistPath, plist);
      console.log("[withShareExtensionFix] Patched ShareExtension activation rules");

      return config;
    },
  ]);
};