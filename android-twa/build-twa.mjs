#!/usr/bin/env node
// Headless Bubblewrap driver — bypasses the interactive CLI by calling
// @bubblewrap/core directly. Generates Android project, keystore, then builds APK.
import { createRequire } from 'node:module';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';

const require = createRequire(import.meta.url);
const core = require('/opt/homebrew/lib/node_modules/@bubblewrap/cli/node_modules/@bubblewrap/core');
const Color = require('/opt/homebrew/lib/node_modules/@bubblewrap/cli/node_modules/color');
const {
  TwaManifest, TwaGenerator, KeyTool, JdkHelper, AndroidSdkTools,
  Config, ConsoleLog, GradleWrapper, DigitalAssetLinks,
} = core;

const log = new ConsoleLog('pose-twa');
const cwd = path.resolve(process.cwd());

const MANIFEST_URL = 'https://pose-tv.156.67.216.187.sslip.io/manifest.webmanifest';
const HOST = 'pose-tv.156.67.216.187.sslip.io';
const PACKAGE_ID = 'com.poserunner.tv';

(async () => {
  // ---------------------------------------------------------------------
  // 1. Build a TwaManifest from the deployed web manifest
  // ---------------------------------------------------------------------
  log.info(`Fetching web manifest from ${MANIFEST_URL}`);
  let twaManifest = await TwaManifest.fromWebManifestJson(
    new URL(MANIFEST_URL),
    (await (await fetch(MANIFEST_URL)).json()),
  );

  // Override the auto-derived fields we want to control
  twaManifest.packageId = PACKAGE_ID;
  twaManifest.host = HOST;
  twaManifest.name = 'Pose-Runner TV';
  twaManifest.launcherName = 'Pose-Runner';
  twaManifest.themeColor = new Color('#5dd6ff');
  twaManifest.themeColorDark = new Color('#07090e');
  twaManifest.navigationColor = new Color('#07090e');
  twaManifest.navigationColorDark = new Color('#07090e');
  twaManifest.navigationDividerColor = new Color('#07090e');
  twaManifest.navigationDividerColorDark = new Color('#07090e');
  twaManifest.backgroundColor = new Color('#07090e');
  twaManifest.startUrl = '/';
  twaManifest.iconUrl = `https://${HOST}/icons/icon-512.png`;
  twaManifest.maskableIconUrl = `https://${HOST}/icons/icon-512-maskable.png`;
  twaManifest.appVersionName = '1.0.0';
  twaManifest.appVersionCode = 1;
  twaManifest.display = 'standalone';
  twaManifest.orientation = 'landscape';
  twaManifest.fallbackType = 'customtabs';
  twaManifest.enableNotifications = false;
  twaManifest.enableSiteSettingsShortcut = true;
  twaManifest.minSdkVersion = 21;
  twaManifest.signingKey = {
    path: path.resolve(cwd, 'android.keystore'),
    alias: 'android',
  };

  // ---------------------------------------------------------------------
  // 2. Set up Config (paths to JDK + Android SDK)
  // ---------------------------------------------------------------------
  const jdkPath = '/opt/homebrew/opt/openjdk@17';
  const sdkPath = '/opt/homebrew/share/android-commandlinetools';
  const config = new Config(jdkPath, sdkPath);
  const configPath = path.resolve(os.homedir(), '.bubblewrap', 'config.json');
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await config.saveConfig(configPath);
  log.info(`Config written to ${configPath}`);

  const jdkHelper = new JdkHelper(process, config);
  const androidSdkTools = await AndroidSdkTools.create(process, config, jdkHelper, log);

  // ---------------------------------------------------------------------
  // 3. Generate keystore
  // ---------------------------------------------------------------------
  const keyToolPath = twaManifest.signingKey.path;
  if (!await exists(keyToolPath)) {
    log.info(`Generating keystore at ${keyToolPath}`);
    const keyTool = new KeyTool(jdkHelper, log);
    await keyTool.createSigningKey({
      path: keyToolPath,
      alias: 'android',
      fullName: 'Khidayotullo Salakhitdinov',
      organization: 'Pose-Runner',
      organizationalUnit: 'Pose-Runner',
      country: 'KH',
      password: 'androidkey',
      keypassword: 'androidkey',
    }, /* overwrite */ false);
  } else {
    log.info(`Keystore already exists at ${keyToolPath}`);
  }

  // ---------------------------------------------------------------------
  // 4. Write twa-manifest.json + materialize Android project
  // ---------------------------------------------------------------------
  await fs.writeFile(path.resolve(cwd, 'twa-manifest.json'), JSON.stringify(twaManifest.toJson(), null, 2));
  log.info('twa-manifest.json written');

  const twaGenerator = new TwaGenerator();
  await twaGenerator.createTwaProject(cwd, twaManifest, log);
  log.info('Android project generated');

  // ---------------------------------------------------------------------
  // 5. Build APK
  // ---------------------------------------------------------------------
  const gradle = new GradleWrapper(process, androidSdkTools, cwd);
  log.info('Running gradle assembleRelease (this takes 2-5 min)...');
  await gradle.assembleRelease();
  log.info('Build done');

  // Sign + zipalign
  const unsignedApk = path.resolve(cwd, 'app/build/outputs/apk/release/app-release-unsigned.apk');
  const signedApk = path.resolve(cwd, 'app-release-signed.apk');
  log.info(`Signing → ${signedApk}`);
  await androidSdkTools.zipalign(unsignedApk, signedApk);
  await androidSdkTools.apksigner(
    twaManifest.signingKey.path,
    'androidkey',
    twaManifest.signingKey.alias,
    'androidkey',
    signedApk,
    signedApk,
  );

  // ---------------------------------------------------------------------
  // 6. Print signing fingerprint for assetlinks.json
  // ---------------------------------------------------------------------
  const keyTool = new KeyTool(jdkHelper, log);
  const sha256 = await keyTool.keyInfo({
    path: twaManifest.signingKey.path,
    alias: 'android',
    password: 'androidkey',
    keypassword: 'androidkey',
  });
  log.info(`Signing cert SHA-256: ${sha256.fingerprints?.find?.((f) => f.name === 'SHA256')?.value ?? '(see keytool output)'}`);

  console.log('\n=== APK READY ===');
  console.log(`  Path:        ${signedApk}`);
  console.log(`  Package ID:  ${PACKAGE_ID}`);
  console.log(`  Manifest:    ${MANIFEST_URL}`);
})().catch((err) => {
  console.error('\n!!! FAILED:', err.message);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});

async function exists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}
