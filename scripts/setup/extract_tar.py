#!/usr/bin/env python3
import os
import sys
import shutil
import tarfile
import argparse

def main():
    parser = argparse.ArgumentParser(description="Extract tar archives, resolving symlinks as copies if symlinks are not supported.")
    parser.add_argument("--archive", required=True, help="Path to the tar archive")
    parser.add_argument("--dest", required=True, help="Destination directory")
    parser.add_argument("--strip-components", type=int, default=0, help="Number of leading components to strip")
    args = parser.parse_args()

    archive_path = args.archive
    dest_dir = args.dest
    strip_components = args.strip_components

    if not os.path.exists(archive_path):
        print(f"Error: Archive not found: {archive_path}", file=sys.stderr)
        sys.exit(1)

    os.makedirs(dest_dir, exist_ok=True)

    # Check if filesystem supports symlinks in dest_dir
    test_link = os.path.join(dest_dir, f".test_symlink_{os.getpid()}")
    use_symlinks = True
    try:
        if os.path.lexists(test_link):
            os.unlink(test_link)
        os.symlink("test_target", test_link)
        os.unlink(test_link)
    except OSError:
        use_symlinks = False

    print(f"Extracting {archive_path} to {dest_dir} (strip-components={strip_components}, use_symlinks={use_symlinks})...")

    try:
        with tarfile.open(archive_path, "r") as tar:
            members = tar.getmembers()
            
            # Map of stripped_path -> target (for symlinks)
            symlinks_dict = {}
            regular_members = []

            for member in members:
                parts = member.name.split('/')
                # Strip leading components
                if len(parts) <= strip_components:
                    continue
                stripped_name = '/'.join(parts[strip_components:])
                if not stripped_name:
                    continue
                
                # Update the member name in-place
                member.name = stripped_name

                if member.issym() or member.islnk():
                    symlinks_dict[member.name] = member.linkname
                else:
                    regular_members.append(member)

            # Extract regular files and directories first
            tar.extractall(path=dest_dir, members=regular_members)

            # Now handle symlinks
            for link_path, link_target in symlinks_dict.items():
                full_link_path = os.path.join(dest_dir, link_path)
                
                # Resolve final target recursively in case of nested symlinks
                link_dir = os.path.dirname(full_link_path)
                
                # Recursive resolver helper
                def resolve_final_target(current_path, current_target):
                    # target_abs is the absolute path to the target file/dir
                    target_abs = os.path.normpath(os.path.join(os.path.dirname(current_path), current_target))
                    # Check if target_abs is inside dest_dir
                    rel_to_dest = os.path.relpath(target_abs, dest_dir)
                    if rel_to_dest in symlinks_dict:
                        next_target = symlinks_dict[rel_to_dest]
                        return resolve_final_target(target_abs, next_target)
                    return target_abs

                target_abs = resolve_final_target(full_link_path, link_target)

                # Ensure parent directory exists
                os.makedirs(link_dir, exist_ok=True)

                if os.path.lexists(full_link_path):
                    try:
                        os.unlink(full_link_path)
                    except OSError:
                        shutil.rmtree(full_link_path, ignore_errors=True)

                if use_symlinks:
                    try:
                        os.symlink(link_target, full_link_path)
                    except OSError:
                        # Fallback to copy if symlink creation fails unexpectedly
                        copy_fallback(target_abs, full_link_path)
                else:
                    copy_fallback(target_abs, full_link_path)

        print("Extraction completed successfully.")
    except Exception as e:
        print(f"Error extracting archive: {e}", file=sys.stderr)
        sys.exit(1)

def copy_fallback(src, dst):
    if not os.path.exists(src):
        # Target doesn't exist. Maybe it's an external link or wasn't extracted.
        print(f"Warning: Symlink target does not exist, skipping copy: {src}", file=sys.stderr)
        return
    try:
        if os.path.isdir(src):
            shutil.copytree(src, dst)
        else:
            shutil.copy2(src, dst)
        print(f"Created fallback copy: {dst} -> {src}")
    except Exception as e:
        print(f"Error copying {src} to {dst}: {e}", file=sys.stderr)

if __name__ == "__main__":
    main()
