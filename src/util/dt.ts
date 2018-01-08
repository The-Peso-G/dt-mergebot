import { fetchText } from "./io";
import { getMonthlyDownloadCount } from "./npm";
import { someAsync } from "./util";

export interface PackageInfo {
    readonly authorIsOwner: boolean;
    readonly owners: ReadonlySet<string>;
    readonly ownersAsLower: ReadonlySet<string>;
    // Manual review is required for changes to popular packages like `types/node`,
    // or changes to files outside of packages (such as `/.github/CODEOWNERS`).
    readonly touchesNonPackage: boolean;
    readonly touchesPopularPackage: boolean;
    readonly touchesMultiplePackages: boolean;
}

let codeOwners: [string, string[]][] = [];
async function fetchCodeOwnersIfNeeded() {
    if (codeOwners.length > 0) return;

    // https://raw.githubusercontent.com/DefinitelyTyped/DefinitelyTyped/master/.github/CODEOWNERS
    const raw = await fetchText("https://raw.githubusercontent.com/DefinitelyTyped/DefinitelyTyped/master/.github/CODEOWNERS");
    for (const line of raw.split(/\r?\n/g)) {
        if (line.trim().length === 0) continue;
        const match = /^(\S+)\s+(.*)$/.exec(line);
        if (!match) throw new Error(`Expected the line from CODEOWNERS to match the regexp - ${line}`);
        
        codeOwners.push([match[1], match[2].split(" ").map(removeLeadingAt)]);
    }

    function removeLeadingAt(s: string) {
        if (s[0] === '@') return s.substr(1);
        return s;
    }
}

export async function getPackagesInfo(
    author: string,
    changedFiles: ReadonlyArray<string>,
    maxMonthlyDownloads: number): Promise<PackageInfo> {

    const { packageNames, touchesNonPackage } = getChangedPackages(changedFiles);
    const owners = new Set<string>();
    const ownersAsLower = new Set<string>();
    let authorIsOwner = false;

    await fetchCodeOwnersIfNeeded();
    for (const codeOwnerLine of codeOwners) {
        for (const fileName of changedFiles) {
            // Reported filename doesn't start with / but the CODEOWNERS filename does
            if (('/' + fileName).startsWith(codeOwnerLine[0])) {
                console.log('file: ' + fileName);
                for (const owner of codeOwnerLine[1]) {
                    console.log('owner: ' + owner);
                    if (author.toLowerCase() === owner.toLowerCase()) {
                        authorIsOwner = true;
                    } else {
                        owners.add(owner);
                        ownersAsLower.add(owner.toLowerCase());
                    }
                }
            }
        }
    }

    const touchesPopularPackage = await someAsync(packageNames, async packageName =>
        await getMonthlyDownloadCount(packageName) > maxMonthlyDownloads);
    const touchesMultiplePackages = packageNames.length > 2;
    return { owners, ownersAsLower, authorIsOwner, touchesNonPackage, touchesPopularPackage, touchesMultiplePackages };
}

interface ChangedPackages {
    readonly packageNames: ReadonlyArray<string>;
    readonly touchesNonPackage: boolean;
}
function getChangedPackages(changedFiles: ReadonlyArray<string>): ChangedPackages {
    let touchesNonPackage = false;
    const packageNames: string[] = [];
    for (const file of changedFiles) {
        const s = withoutStart(file, "types/");
        if (s === undefined) {
            touchesNonPackage = true;
            continue;
        }

        const slash = s.indexOf("/");
        if (slash === -1) {
            // Be suspicious of anything adding a file to `types/` -- should be mostly directories
            touchesNonPackage = true;
            continue;
        }

        packageNames.push(s.slice(0, slash));
    }
    return { packageNames, touchesNonPackage };
}

function withoutStart(s: string, start: string): string | undefined {
    return s.startsWith(start) ? s.slice(start.length) : undefined;
}
