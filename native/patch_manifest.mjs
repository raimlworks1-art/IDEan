import { readFileSync, writeFileSync } from 'node:fs';

const manifest_path = 'android/app/src/main/AndroidManifest.xml';
const xml = readFileSync(manifest_path, 'utf8');

if (!xml.includes('android.intent.action.EDIT')) {
  const filter = `
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <action android:name="android.intent.action.EDIT" />
                <category android:name="android.intent.category.DEFAULT" />
                <data android:scheme="content" />
                <data android:scheme="file" />
                <data android:mimeType="*/*" />
            </intent-filter>
        `;
  writeFileSync(manifest_path, xml.replace('</activity>', `${filter}</activity>`));
}
