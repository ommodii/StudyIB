const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, BorderStyle, ShadingType, Table, TableRow, TableCell, WidthType, PageBreak, Footer, PageNumber, ExternalHyperlink } = require('docx');
const fs = require('fs');

const blue = '1F4E78';
const lightBlue = 'D9EAF7';
const pale = 'F3F6F9';
const dark = '1F2937';
const orange = 'F4B183';

function p(text = '', options = {}) {
  return new Paragraph({
    spacing: { after: options.after ?? 140, line: options.line ?? 276 },
    alignment: options.alignment,
    children: [new TextRun({ text, bold: options.bold, italics: options.italics, color: options.color, size: options.size })]
  });
}

function rich(parts, options = {}) {
  return new Paragraph({
    spacing: { after: options.after ?? 140, line: 276 },
    children: parts.map(x => new TextRun(x))
  });
}

function h(text, level = 1) {
  return new Paragraph({ text, heading: level === 1 ? HeadingLevel.HEADING_1 : level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3, spacing: { before: level === 1 ? 360 : 240, after: 140 } });
}

function bullet(text, level = 0) {
  return new Paragraph({ text, bullet: { level }, spacing: { after: 80, line: 260 } });
}

function numbered(text, level = 0) {
  return new Paragraph({ text, numbering: { reference: 'steps', level }, spacing: { after: 100, line: 270 } });
}

function code(text) {
  return new Paragraph({
    spacing: { before: 80, after: 160 },
    indent: { left: 360, right: 360 },
    shading: { type: ShadingType.CLEAR, fill: 'EEF2F7' },
    border: { left: { color: blue, size: 12, style: BorderStyle.SINGLE } },
    children: [new TextRun({ text, font: 'Consolas', size: 19, color: '172033' })]
  });
}

function callout(title, text, color = lightBlue) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    margins: { top: 120, bottom: 120, left: 180, right: 180 },
    rows: [new TableRow({ children: [new TableCell({
      shading: { type: ShadingType.CLEAR, fill: color },
      borders: { top: { style: BorderStyle.SINGLE, size: 8, color: blue }, bottom: { style: BorderStyle.SINGLE, size: 8, color: blue }, left: { style: BorderStyle.SINGLE, size: 8, color: blue }, right: { style: BorderStyle.SINGLE, size: 8, color: blue } },
      children: [rich([{ text: title + ': ', bold: true }, { text }], { after: 0 })]
    })] })]
  });
}

function link(label, url) {
  return new Paragraph({ spacing: { after: 90 }, children: [new ExternalHyperlink({ link: url, children: [new TextRun({ text: label, style: 'Hyperlink' })] }), new TextRun({ text: ` — ${url}`, color: '666666', size: 18 })] });
}

function checklist(text) {
  return new Paragraph({ spacing: { after: 90 }, children: [new TextRun({ text: '☐  ', font: 'Arial', size: 22 }), new TextRun(text)] });
}

function pageBreak() { return new Paragraph({ children: [new PageBreak()] }); }

const children = [];

children.push(
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 900, after: 260 }, children: [new TextRun({ text: 'Publishing StudyIB on the Web', bold: true, size: 42, color: blue })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 180 }, children: [new TextRun({ text: 'A complete beginner’s guide to Cloudflare DNS, Workers, Pages backup, and R2', size: 27, color: dark })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 520 }, children: [new TextRun({ text: 'Tailored to the StudyIB GitHub repository and its 2.62 GiB Content folder', italics: true, size: 21, color: '5B6573' })] }),
  callout('The final result', 'Visitors open ommodi.site. Cloudflare Workers Static Assets serves the small website files, while Cloudflare R2 serves the large PDF/content files from assets.ommodi.site. studyib.pages.dev remains available as a backup deployment. The Content folder is not uploaded to GitHub or the frontend host.'),
  p('Prepared July 2026', { alignment: AlignmentType.CENTER, italics: true, color: '6B7280', after: 600 }),
  h('Before you begin', 1),
  checklist('You can sign in to Namecheap, where your domain is registered.'),
  checklist('You can sign in to a Cloudflare account. The domain may not be added there yet; this guide covers that.'),
  checklist('You can sign in to GitHub and can see the repository ommodii/StudyIB.'),
  checklist('The Content folder contains only material you are legally allowed to publish worldwide.'),
  checklist('You have access to the Windows computer containing C:\\Users\\OGMod\\Documents\\app.'),
  checklist('You are willing to add a payment method during R2 activation if Cloudflare requests one. Staying inside the free allowance should still produce a $0 usage charge.'),
  pageBreak(),

  h('1. The three concepts you need to understand', 1),
  h('1.1 Your domain name', 2),
  p('A domain is the human-readable address people type. Your production domain is ommodi.site, and Namecheap remains its registrar.'),
  h('1.2 Registrar, nameservers, and DNS', 2),
  bullet('Registrar: the company where the domain was purchased and renewed. For your domain, this is Namecheap.'),
  bullet('Nameservers: the service that is authoritative for the domain’s DNS instructions. You may have meant “namespace”; the relevant term here is nameserver.'),
  bullet('DNS records: instructions that connect names such as www.example.com or assets.example.com to services.'),
  bullet('In your setup, Namecheap remains the registrar and renewal company. Cloudflare will become the authoritative DNS/nameserver provider and the hosting platform.'),
  callout('This does not transfer the domain', 'Changing nameservers does not move ownership or billing away from Namecheap. You will continue renewing the domain at Namecheap; Cloudflare will answer DNS requests and host the site.'),
  h('1.3 The two hosting services', 2),
  bullet('Cloudflare Workers Static Assets serves index.html, CSS, JavaScript, and the small data scripts on ommodi.site and www.ommodi.site.'),
  bullet('Cloudflare Pages keeps a backup copy at studyib.pages.dev.'),
  bullet('Cloudflare R2 stores the 2.62 GiB Content folder and serves its PDFs and other large files.'),
  p('The finished layout will look like this:'),
  code('https://ommodi.site                 → Workers Static Assets → website\nhttps://www.ommodi.site             → Workers Static Assets → website\nhttps://studyib.pages.dev           → Cloudflare Pages backup\nhttps://assets.ommodi.site          → Cloudflare R2 → Content/PDF files\nhttps://github.com/ommodii/StudyIB  → source code only; no Content folder'),

  h('2. Connect the Namecheap domain to Cloudflare nameservers', 1),
  p('Namecheap currently controls the registration. The steps below add the domain to Cloudflare first, copy all important DNS records, and then tell Namecheap to use Cloudflare’s two assigned nameservers.'),
  h('2.1 Record the current Namecheap setup before changing anything', 2),
  numbered('Open https://namecheap.com and sign in.'),
  numbered('Open Domain List in the left sidebar.'),
  numbered('Find your domain and select Manage.'),
  numbered('On the Domain tab, find Nameservers and write down the current selection, such as Namecheap BasicDNS, Namecheap Web Hosting DNS, or Custom DNS.'),
  numbered('Open Advanced DNS in a second tab. Take screenshots or copy every Host Record, Mail Settings entry, redirect, MX record, and TXT record you rely on. This is especially important if you use email at your domain.'),
  numbered('In Advanced DNS, check whether DNSSEC is enabled or whether DS records exist. If DNSSEC/DS records are active, disable or remove the old Namecheap-side DNSSEC configuration before changing nameservers. You can enable Cloudflare DNSSEC after the move is complete.'),
  callout('Do not skip the record backup', 'Namecheap states that host records are not automatically moved when nameservers change. Cloudflare performs a scan, but it may not discover every record. Missing MX/TXT records can break domain email.'),
  h('2.2 Add the domain to Cloudflare', 2),
  numbered('Open https://dash.cloudflare.com and sign in.'),
  numbered('Open Domains or Websites, then select Onboard a domain or Add a domain.'),
  numbered('Enter only the apex domain—for example, example.com. Do not enter www, https://, or a page path.'),
  numbered('Select the Free plan unless you deliberately want a paid Cloudflare plan.'),
  numbered('Allow Cloudflare to scan the existing DNS records.'),
  numbered('Carefully compare Cloudflare’s imported DNS records with the screenshots/list from Namecheap. Recreate any missing email MX, SPF, DKIM, DMARC, verification TXT, or other important records before continuing.'),
  numbered('Continue until Cloudflare displays two assigned authoritative nameservers. They look similar to ada.ns.cloudflare.com and bob.ns.cloudflare.com, but your two names will be different.'),
  numbered('Keep this Cloudflare tab open and copy both nameservers exactly into the worksheet below.'),
  h('2.3 Change the nameservers at Namecheap', 2),
  numbered('Return to Namecheap → Domain List → Manage for the domain.'),
  numbered('On the Domain tab, locate the Nameservers dropdown.'),
  numbered('Select Custom DNS. Do not choose Namecheap BasicDNS, Web Hosting DNS, or PremiumDNS.'),
  numbered('Paste the first Cloudflare nameserver into Nameserver 1 and the second into Nameserver 2. Enter hostnames only—no IP addresses, spaces, or https://.'),
  numbered('Remove any extra nameserver rows so only the two assigned Cloudflare nameservers remain.'),
  numbered('Select the green checkmark/save control.'),
  numbered('Return to Cloudflare and select the button to check nameservers if one is shown.'),
  numbered('Wait for activation. Cloudflare and Namecheap advise that nameserver changes can take up to 24 hours, although they are often faster.'),
  numbered('Cloudflare will show the domain as Active and normally sends an activation email when the change is detected.'),
  numbered('After Cloudflare is Active and everything works, you may enable DNSSEC from Cloudflare DNS settings and follow Cloudflare’s displayed DS-record instructions for Namecheap. Leave this until after initial hosting works if you are unsure.'),
  callout('Do not guess nameservers', 'Use only the exact two nameservers assigned on this domain’s Cloudflare Overview page. Never copy nameservers from this guide, another domain, or a video.'),
  h('Domain worksheet', 2),
  code('My domain: __________________________________________\nRegistrar: Namecheap\nOriginal Namecheap nameserver setting: _______________\nCloudflare account email: ____________________________\nCloudflare domain status: Active / Pending____________\nCloudflare nameserver 1: _____________________________\nCloudflare nameserver 2: _____________________________\nDNS/email records backed up: Yes / No_________________\nOld DNSSEC disabled (if applicable): Yes / N/A________'),
  h('Checkpoint A', 2),
  checklist('Namecheap → Domain List → Manage shows Custom DNS with exactly the two Cloudflare-assigned nameservers.'),
  checklist('The domain appears in Cloudflare under Domains/Websites and its status is Active.'),
  checklist('Important Namecheap DNS and email records were copied into Cloudflare DNS before the switch.'),
  checklist('Opening DNS → Records shows your domain’s current records.'),
  pageBreak(),

  h('3. Create and activate Cloudflare R2', 1),
  p('R2 is object storage: it keeps files and retrieves them by path. Your current 2.62 GiB is below R2’s 10 GB-month Standard free allowance. Cloudflare may still require an R2 subscription checkout and payment method. Usage beyond the free allowance is billable.'),
  numbered('In the Cloudflare dashboard, select Storage & databases.'),
  numbered('Select R2 Object Storage, then Overview.'),
  numbered('If prompted, select Purchase R2 or Get started and complete the checkout flow. Read the pricing shown in your account before confirming.'),
  numbered('On the R2 Overview page, select Create bucket.'),
  numbered('For the bucket name, enter studyib-content. Bucket names should be lowercase and use hyphens.'),
  numbered('Use the default location unless you have a specific legal or data-residency requirement.'),
  numbered('Create the bucket. Do not enable R2 Data Catalog; it is unrelated to this website.'),
  code('Bucket name: studyib-content'),
  callout('Cost safety', 'Open Billing and set notifications if your Cloudflare account offers them. Review R2 Analytics after launch. The free allowance is an allowance, not a hard spending cap.'),
  h('Checkpoint B', 2),
  checklist('R2 Overview shows a bucket named studyib-content.'),
  checklist('The bucket is empty.'),

  h('4. Create a narrowly scoped upload key', 1),
  p('The upload program needs an Access Key ID and Secret Access Key. These are passwords for R2. Never put either value in GitHub, JavaScript, screenshots, chat messages, or the public website.'),
  numbered('On R2 Overview, locate Account Details.'),
  numbered('Next to API Tokens, select Manage.'),
  numbered('Select Create User API token or Create Account API token. A user token is fine for a personal setup.'),
  numbered('Name it StudyIB local uploader.'),
  numbered('Choose Object Read & Write permission.'),
  numbered('Scope it to the specific studyib-content bucket, not every bucket.'),
  numbered('Create the token.'),
  numbered('Immediately copy the Access Key ID, Secret Access Key, account ID, and S3 endpoint into a temporary private password-manager note. Cloudflare will not show the secret again.'),
  code('Access Key ID: [KEEP SECRET]\nSecret Access Key: [KEEP SECRET]\nAccount ID: _________________________________________\nEndpoint: https://ACCOUNT_ID.r2.cloudflarestorage.com'),
  callout('Security', 'If you accidentally expose the secret, revoke the token in Cloudflare and create a new one. The browser never needs this secret; public downloads use the custom assets domain.'),
  pageBreak(),

  h('5. Install rclone on Windows', 1),
  p('rclone is a file-transfer program recommended by Cloudflare for bulk uploads and directory synchronization.'),
  numbered('Open the Windows Start menu.'),
  numbered('Type PowerShell.'),
  numbered('Open Windows PowerShell or Terminal.'),
  numbered('Run the following installation command:'),
  code('winget install Rclone.Rclone'),
  numbered('Close PowerShell after installation and open it again.'),
  numbered('Confirm the installation:'),
  code('rclone version'),
  p('If Windows says winget is unavailable, download rclone from https://rclone.org/downloads/, extract rclone.exe, and follow its Windows installation instructions.'),

  h('6. Connect rclone to the R2 bucket', 1),
  numbered('In PowerShell, run:'),
  code('rclone config'),
  numbered('Type n and press Enter to create a new remote.'),
  numbered('For name, type r2 and press Enter.'),
  numbered('For storage type, select Amazon S3 Compliant Storage. The menu number can change, so choose by name rather than copying a number from a video.'),
  numbered('For provider, select Cloudflare R2 storage.'),
  numbered('For env_auth, choose false or press Enter for the default.'),
  numbered('Paste the Access Key ID when prompted.'),
  numbered('Paste the Secret Access Key when prompted. PowerShell may not visually show pasted password characters; that is normal.'),
  numbered('For region, accept auto/default.'),
  numbered('For endpoint, paste https://ACCOUNT_ID.r2.cloudflarestorage.com using your real account ID.'),
  numbered('For location constraint and ACL, accept the defaults.'),
  numbered('Do not edit advanced configuration unless rclone specifically requires it.'),
  numbered('Save the remote when asked. The remote’s name is r2.'),
  numbered('Test that rclone can see the bucket:'),
  code('rclone lsd r2:'),
  p('The result should contain studyib-content.'),
  callout('If bucket listing fails', 'Recheck the endpoint, access key, secret, permission, and bucket scope. Do not paste the credentials into a public support post.'),

  h('7. Upload the Content folder', 1),
  p('This guide keeps the Content directory name in R2 because the app’s data files already contain paths beginning with Content/. That avoids rewriting thousands of stored paths.'),
  numbered('Confirm the folder exists at C:\\Users\\OGMod\\Documents\\app\\Content.'),
  numbered('Run this command in PowerShell. Keep the quotes:'),
  code('rclone copy "C:\\Users\\OGMod\\Documents\\app\\Content" "r2:studyib-content/Content" --progress --transfers 8 --checkers 16'),
  numbered('Leave the window open. The first upload can take a long time depending on upload speed.'),
  numbered('If the transfer is interrupted, run the same command again. rclone will compare files and continue rather than blindly duplicating everything.'),
  numbered('When it completes, compare the remote and local totals:'),
  code('rclone size "C:\\Users\\OGMod\\Documents\\app\\Content"\nrclone size "r2:studyib-content/Content"'),
  numbered('Perform a verification pass:'),
  code('rclone check "C:\\Users\\OGMod\\Documents\\app\\Content" "r2:studyib-content/Content" --one-way'),
  callout('Use copy, not sync, at first', 'rclone sync can delete remote files that do not exist locally. Use rclone copy until you fully understand the deletion behavior.'),
  h('Checkpoint C', 2),
  checklist('The local and remote file counts and total sizes are approximately equal.'),
  checklist('The R2 dashboard shows a top-level Content folder/prefix.'),
  checklist('Opening Content in the dashboard shows the expected subfolders.'),
  pageBreak(),

  h('8. Connect assets.ommodi.site to R2', 1),
  numbered('In Cloudflare, go to R2 Object Storage and open studyib-content.'),
  numbered('Open Settings.'),
  numbered('Find Custom Domains and select Connect Domain.'),
  numbered('Enter assets.ommodi.site.'),
  numbered('Confirm the DNS change. Cloudflare should create the necessary DNS record and TLS certificate automatically because the domain is already active in the same account.'),
  numbered('Wait until the custom domain status is Active.'),
  numbered('Do not use the r2.dev URL for production. Leave it disabled after testing; the custom domain is the production address.'),
  p('Choose one PDF in the R2 dashboard and note its full object key. Test it in a browser using this pattern:'),
  code('https://assets.ommodi.site/Content/Subfolder/File.pdf'),
  callout('Spaces in filenames', 'A browser normally encodes spaces automatically. When testing manually, copying the exact address from the browser is safer than typing a long filename.'),

  h('9. Add CORS so the PDF viewer is allowed to read R2', 1),
  p('Your website and assets subdomain are different origins. Browser security therefore requires an explicit CORS policy. Add both the apex domain and www domain now; harmless unused entries are acceptable.'),
  numbered('Open studyib-content → Settings.'),
  numbered('Find CORS Policy and select Add or Edit.'),
  numbered('Use the repository r2-cors.json file, which contains the active Cloudflare R2 API format shown below:'),
  code('{\n  "rules": [{\n    "allowed": {\n      "origins": [\n        "https://ommodi.site",\n        "https://www.ommodi.site",\n        "https://studyib.pages.dev",\n        "http://localhost:8000"\n      ],\n      "methods": ["GET", "HEAD"],\n      "headers": ["Range"]\n    },\n    "exposeHeaders": [\n      "Accept-Ranges", "Content-Length", "Content-Range", "ETag"\n    ],\n    "maxAgeSeconds": 86400\n  }]\n}'),
  numbered('Save the policy and allow roughly 30 seconds for propagation.'),
  callout('Exact matching matters', 'An allowed origin contains only scheme and host—no trailing slash and no path. https://example.com is valid; https://example.com/ is not the same CORS entry.'),

  h('10. Prepare StudyIB to use R2', 1),
  p('The repository currently assumes every PDF is beside the site under a relative Content/... path. It also has a build script that copies Content into www. Before Pages deployment, the app needs a small URL resolver and the build must stop copying Content.'),
  h('Recommended beginner route', 2),
  p('Ask Codex to make this code change for you using this exact request:'),
  code('The app now uses https://assets.ommodi.site as the content base URL, preserves existing Content/... paths, resolves those paths when loading PDFs, includes config.js in the web build, and excludes Content from the frontend build.'),
  p('These changes are already implemented in the repository. Keep config.js and r2-cors.json aligned if the domain ever changes.'),
  h('What that change should accomplish', 2),
  bullet('Create config.js with the R2 custom-domain base URL.'),
  bullet('The resolver turns Content/Folder/File.pdf into https://assets.ommodi.site/Content/Folder/File.pdf.'),
  bullet('Apply the resolver at the PDF.js loading points in app.js and atom.js.'),
  bullet('Keep relative paths in progress tracking/local storage so existing identifiers remain stable.'),
  bullet('Add config.js to filesToCopy in build_web.js.'),
  bullet('Remove Content from foldersToCopy in build_web.js.'),
  bullet('Keep /Content/ in .gitignore so the large files remain outside GitHub.'),
  h('Checkpoint D', 2),
  checklist('Content is still ignored by Git.'),
  checklist('No R2 access key or secret appears in any repository file.'),
  checklist('Running node build_web.js creates www without a www/Content directory.'),
  checklist('The resulting www/config.js contains only the public assets URL, not credentials.'),
  pageBreak(),

  h('11. Test the app locally before publishing', 1),
  numbered('Open PowerShell in C:\\Users\\OGMod\\Documents\\app.'),
  numbered('Build the website:'),
  code('node build_web.js'),
  numbered('Move into the generated website folder:'),
  code('cd www'),
  numbered('Start a local server:'),
  code('python -m http.server 8000'),
  numbered('Open http://localhost:8000 in Chrome or Edge.'),
  numbered('Open several question papers, including at least one of the largest PDFs.'),
  numbered('Press F12, open Console, and look for red errors.'),
  numbered('Open the Network tab, reload, select a PDF request, and confirm the request URL begins with https://assets.ommodi.site/Content/.'),
  numbered('Stop the server by returning to PowerShell and pressing Ctrl+C.'),
  h('Common local-test failures', 2),
  bullet('CORS error: add http://localhost:8000 to AllowedOrigins exactly and wait 30 seconds.'),
  bullet('404 Not Found: the URL path and R2 object key do not match exactly, including capitalization.'),
  bullet('Access Denied: the R2 custom domain is not active or public access through that domain is not enabled.'),
  bullet('Failed to load PDF with HTTP 206/range issues: confirm GET and HEAD, Range, and exposed range headers are present in CORS.'),

  h('12. Deploy the frontend', 1),
  p('The current production frontend uses Cloudflare Workers Static Assets. The repository also keeps a direct-upload Pages project as a backup.'),
  numbered('Open PowerShell in C:\\Users\\OGMod\\Documents\\app.'),
  numbered('Rebuild the small frontend:'),
  code('node build_web.js'),
  numbered('Deploy the frontend and its two existing domain routes using wrangler.jsonc:'),
  code('wrangler deploy'),
  numbered('Optionally refresh the Pages backup:'),
  code('wrangler pages deploy www --project-name studyib --branch main --commit-dirty=true'),
  numbered('Open https://ommodi.site, https://www.ommodi.site, and https://studyib.pages.dev to verify them.'),
  callout('Why Workers owns the main domains', 'The existing apex and www DNS records already route through Cloudflare. Workers routes can serve the current static build on those hostnames without replacing unrelated DNS records. The route configuration is versioned in wrangler.jsonc.'),

  h('13. Current domain routing', 1),
  bullet('ommodi.site/* routes to the studyib-site Worker static-assets deployment.'),
  bullet('www.ommodi.site/* routes to the same deployment.'),
  bullet('studyib.pages.dev remains the Pages backup.'),
  bullet('assets.ommodi.site is connected directly to the studyib-content R2 bucket with TLS 1.2 minimum.'),
  callout('Do not delete the routes casually', 'Removing or replacing the ommodi.site/* or www.ommodi.site/* Worker routes can reveal the older origin site again. Keep wrangler.jsonc in the repository and redeploy it after intentional routing changes.'),
  h('Checkpoint E — the launch test', 2),
  checklist('https://ommodi.site opens with a valid padlock.'),
  checklist('The interface CSS and JavaScript load correctly.'),
  checklist('At least one PDF from every major section opens.'),
  checklist('A PDF larger than 25 MiB opens successfully from assets.ommodi.site.'),
  checklist('Browser Developer Tools show no CORS or mixed-content errors.'),
  checklist('https://assets.ommodi.site/Content/... opens a known object.'),
  checklist('The GitHub repository does not contain Content or credentials.'),
  pageBreak(),

  h('14. Updating the website later', 1),
  h('Code-only update', 2),
  numbered('Change the files in C:\\Users\\OGMod\\Documents\\app.'),
  numbered('Test locally.'),
  numbered('Run node build_web.js, then wrangler deploy. Commit and push the source changes to main.'),
  h('Adding or updating content files', 2),
  numbered('Update the local Content folder.'),
  numbered('Run the repository upload helper. It uses your existing Wrangler login and safely overwrites matching object keys without deleting unrelated remote objects:'),
  code('node Utils/upload_content_to_r2.js'),
  numbered('If paths were added to data.js or another index file, commit and push those code/data index changes separately.'),
  h('Removing an obsolete R2 file', 2),
  p('Delete only the exact object after confirming the app no longer references it. Keep a local backup. Do not run broad deletion commands while learning.'),

  h('15. Monitoring usage and avoiding surprises', 1),
  bullet('Open R2 → studyib-content → Metrics/Analytics periodically.'),
  bullet('Watch stored bytes, Class A operations (writes/lists), and Class B operations (reads).'),
  bullet('Standard R2 currently includes 10 GB-month storage, 1 million Class A operations, and 10 million Class B operations monthly. Internet egress from R2 is currently free. Verify current pricing in Cloudflare before launch and periodically afterward.'),
  bullet('Heavy traffic can exceed the operation allowance even when storage stays below 10 GB.'),
  bullet('Use the R2 custom domain so Cloudflare caching can help reduce origin reads.'),
  bullet('Never assume “free tier” means a hard cap. Review billing settings and alerts.'),
  bullet('Keep a second local/offline backup. R2 hosting is not your only backup.'),

  h('16. Security and legal checklist', 1),
  checklist('Every public file is owned by you, licensed for redistribution, or in the public domain.'),
  checklist('Generated extracts and mark schemes have also been reviewed; removing an original does not automatically clear derived copies.'),
  checklist('No private student information or personal notes are in Content.'),
  checklist('R2 credentials exist only in the private rclone configuration/password manager.'),
  checklist('The upload token is scoped only to studyib-content.'),
  checklist('Content remains in .gitignore.'),
  checklist('You have a privacy policy if the site collects identifiable analytics or user information.'),
  checklist('You have a process for responding to legitimate copyright or privacy reports.'),
  callout('Public means downloadable', 'A public R2 custom domain does not prevent users from downloading files they can access. If the files require user authentication, the architecture needs a Worker or backend access-control layer instead.'),
  pageBreak(),

  h('17. Troubleshooting decision guide', 1),
  h('The domain does not open', 2),
  bullet('Check that the domain’s Cloudflare Websites status is Active.'),
  bullet('Check Workers & Pages → studyib-site and confirm the ommodi.site/* and www.ommodi.site/* routes are present.'),
  bullet('Check DNS → Records, but do not randomly delete records.'),
  bullet('If nameservers changed recently, wait for propagation.'),
  h('The website opens, but PDFs fail', 2),
  bullet('Open Developer Tools → Network and inspect the failing PDF URL.'),
  bullet('404 means the object key/path is wrong.'),
  bullet('403/Access Denied means R2 public custom-domain access is not configured correctly.'),
  bullet('A CORS console error means the website origin is missing from the bucket CORS policy.'),
  bullet('Mixed-content errors mean an http:// asset URL was used from an https:// page. Use HTTPS everywhere.'),
  h('Frontend build or deployment fails', 2),
  bullet('Confirm the build command is node build_web.js.'),
  bullet('Confirm the output directory is www.'),
  bullet('Confirm build_web.js no longer tries to package Content.'),
  bullet('Read the first actual error in the deployment log rather than only the final “failed” line.'),
  h('Some PDF filenames work and others do not', 2),
  bullet('Check capitalization, spaces, brackets, apostrophes, and Unicode characters.'),
  bullet('Compare the requested URL with the exact R2 object key.'),
  bullet('Use the resolver rather than manually concatenating or pre-encoding filenames in many places.'),

  h('18. Master setup worksheet', 1),
  code('Domain: ommodi.site\nRegistrar: Namecheap\nNamecheap nameserver mode: Custom DNS\nCloudflare nameserver 1: etta.ns.cloudflare.com\nCloudflare nameserver 2: huxley.ns.cloudflare.com\nCloudflare zone status: Active\n\nWorker project: studyib-site\nWorker routes: ommodi.site/* and www.ommodi.site/*\nPages backup project: studyib\nPages backup URL: https://studyib.pages.dev\nPrimary site URL: https://ommodi.site\nOptional www URL: https://www.ommodi.site\n\nR2 bucket: studyib-content\nR2 asset domain: https://assets.ommodi.site\nR2 TLS status: Active; minimum TLS 1.2\n\nLocal project: C:\\Users\\OGMod\\Documents\\app\nLocal content: C:\\Users\\OGMod\\Documents\\app\\Content\nGitHub: https://github.com/ommodii/StudyIB\nProduction branch: main'),

  h('19. Official references', 1),
  link('Namecheap — Change DNS/nameservers for a domain', 'https://www.namecheap.com/support/knowledgebase/article.aspx/767/10/how-to-change-dns-for-a-domain/'),
  link('Namecheap — DNSSEC with custom nameservers', 'https://www.namecheap.com/support/knowledgebase/article.aspx/9722/2232/managing-dnssec-for-domains-pointed-to-custom-dns/'),
  link('Cloudflare DNS — Add a domain and change nameservers', 'https://developers.cloudflare.com/dns/zone-setups/full-setup/setup/'),
  link('Cloudflare R2 — Get started', 'https://developers.cloudflare.com/r2/get-started/'),
  link('Cloudflare R2 — Pricing', 'https://developers.cloudflare.com/r2/pricing/'),
  link('Cloudflare R2 — API token authentication', 'https://developers.cloudflare.com/r2/api/tokens/'),
  link('Cloudflare R2 — rclone example', 'https://developers.cloudflare.com/r2/examples/rclone/'),
  link('Cloudflare R2 — Public buckets and custom domains', 'https://developers.cloudflare.com/r2/buckets/public-buckets/'),
  link('Cloudflare R2 — Configure CORS', 'https://developers.cloudflare.com/r2/buckets/cors/'),
  link('Cloudflare Pages — Git integration', 'https://developers.cloudflare.com/pages/get-started/git-integration/'),
  link('Cloudflare Pages — Custom domains', 'https://developers.cloudflare.com/pages/configuration/custom-domains/'),
  link('Cloudflare Pages — Platform limits', 'https://developers.cloudflare.com/pages/platform/limits/'),
  link('Cloudflare Workers — Static Assets', 'https://developers.cloudflare.com/workers/static-assets/'),
  link('Cloudflare Workers — Routes', 'https://developers.cloudflare.com/workers/configuration/routing/routes/'),
  link('rclone downloads', 'https://rclone.org/downloads/'),
  p('Cloudflare changes its dashboard wording and product limits over time. If a label differs slightly, use the official reference links above and look for the same product/setting. Pricing and limits should always be rechecked in the dashboard before enabling billable use.', { italics: true, color: '5B6573' })
);

const doc = new Document({
  styles: {
    default: { document: { run: { font: 'Aptos', size: 22, color: dark }, paragraph: { spacing: { line: 276 } } } },
    paragraphStyles: [
      { id: 'Title', name: 'Title', basedOn: 'Normal', next: 'Normal', run: { font: 'Aptos Display', size: 44, bold: true, color: blue } },
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: 'Aptos Display', size: 31, bold: true, color: blue }, paragraph: { spacing: { before: 360, after: 140 }, keepNext: true } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: 'Aptos Display', size: 26, bold: true, color: '2F6690' }, paragraph: { spacing: { before: 260, after: 120 }, keepNext: true } },
      { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: 'Aptos', size: 23, bold: true, color: dark }, paragraph: { spacing: { before: 180, after: 100 }, keepNext: true } }
    ]
  },
  numbering: {
    config: [{ reference: 'steps', levels: [
      { level: 0, format: 'decimal', text: '%1.', alignment: AlignmentType.START, style: { paragraph: { indent: { left: 540, hanging: 300 } } } },
      { level: 1, format: 'lowerLetter', text: '%2.', alignment: AlignmentType.START, style: { paragraph: { indent: { left: 900, hanging: 300 } } } }
    ] }]
  },
  sections: [{
    properties: { page: { margin: { top: 720, right: 720, bottom: 720, left: 720 } } },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'StudyIB Cloudflare Hosting Guide  •  Page ', color: '6B7280', size: 18 }), new TextRun({ children: [PageNumber.CURRENT], color: '6B7280', size: 18 })] })] }) },
    children
  }]
});

Packer.toBuffer(doc).then(buffer => {
  fs.writeFileSync('Cloudflare_Hosting_Guide_StudyIB.docx', buffer);
  console.log(`Created Cloudflare_Hosting_Guide_StudyIB.docx (${buffer.length} bytes)`);
});
