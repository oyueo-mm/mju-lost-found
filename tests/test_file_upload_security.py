"""File upload security audit: save_uploaded_image() attack tests.

Uses a small duck-typed fake in place of Streamlit's real UploadedFile --
save_uploaded_image() only ever calls .name and .getbuffer() on its
argument, so a fake with just those two members exercises the exact same
code path a real multipart upload (crafted to bypass the browser's
file-picker `type=[...]` filter) would hit.

Every file this test creates is written under a temporary directory (this
module monkeypatches ui.common.UPLOAD_DIR/PROJECT_ROOT for the duration of
each test) -- nothing here touches the project's real uploads/ directory.

save_uploaded_image() now enforces a server-side suffix allowlist
(ALLOWED_IMAGE_SUFFIXES) -- the tests below that previously documented
".html/.svg/.py/.js/.txt are silently accepted" (the LOW finding from the
prior audit) now assert the opposite: those extensions are rejected with
ValueError. This is the one deliberate expectation flip in this file, made
because the implementation changed, not to hide a problem.
"""

import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from ui import common


class FakeUploadedFile:
    def __init__(self, name: str, content: bytes = b"fake file content"):
        self.name = name
        self._content = content

    def getbuffer(self):
        return self._content


class FileUploadSecurityTestCase(unittest.TestCase):
    def setUp(self):
        self._tmp_dir = tempfile.TemporaryDirectory()
        self.project_root = Path(self._tmp_dir.name)
        self.upload_dir = self.project_root / "uploads"
        self.upload_dir.mkdir()

        self._patchers = [
            patch.object(common, "PROJECT_ROOT", self.project_root),
            patch.object(common, "UPLOAD_DIR", self.upload_dir),
        ]
        for p in self._patchers:
            p.start()

    def tearDown(self):
        for p in self._patchers:
            p.stop()
        self._tmp_dir.cleanup()

    # ---------- server-side extension enforcement ----------

    def test_none_upload_returns_none(self):
        self.assertIsNone(common.save_uploaded_image(None))

    def test_legitimate_jpg_saved(self):
        rel_path = common.save_uploaded_image(FakeUploadedFile("photo.jpg"))
        self.assertTrue((self.project_root / rel_path).exists())
        self.assertTrue(rel_path.endswith(".jpg"))

    def test_legitimate_jpeg_saved(self):
        rel_path = common.save_uploaded_image(FakeUploadedFile("photo.jpeg"))
        self.assertTrue((self.project_root / rel_path).exists())

    def test_legitimate_png_saved(self):
        rel_path = common.save_uploaded_image(FakeUploadedFile("photo.png"))
        self.assertTrue((self.project_root / rel_path).exists())

    def test_uppercase_extension_still_allowed(self):
        """Case must not be a bypass in either direction: .PNG is still a
        legitimate image and must be accepted (suffix is lowercased before
        the allowlist check, but the file is still saved normally)."""
        for name in ("photo.PNG", "photo.JPG", "photo.JPEG"):
            rel_path = common.save_uploaded_image(FakeUploadedFile(name))
            self.assertTrue((self.project_root / rel_path).exists())

    def test_html_extension_rejected(self):
        """A crafted multipart request naming the file "x.html" (bypassing
        the browser file-picker's type=["jpg","jpeg","png"] filter, which
        is client-side only) must now be rejected server-side."""
        with self.assertRaises(ValueError):
            common.save_uploaded_image(FakeUploadedFile("evil.html"))
        self.assertEqual(list(self.upload_dir.iterdir()), [])  # nothing written

    def test_svg_extension_rejected(self):
        with self.assertRaises(ValueError):
            common.save_uploaded_image(FakeUploadedFile("evil.svg", b"<svg onload=alert(1)></svg>"))
        self.assertEqual(list(self.upload_dir.iterdir()), [])

    def test_py_js_txt_extensions_rejected(self):
        for name in ("evil.py", "evil.js", "evil.txt"):
            with self.assertRaises(ValueError):
                common.save_uploaded_image(FakeUploadedFile(name))
        self.assertEqual(list(self.upload_dir.iterdir()), [])

    def test_uppercase_disallowed_extension_still_rejected(self):
        """Uppercasing a disallowed extension must not bypass the check
        either -- the same lowercasing applies before comparison."""
        with self.assertRaises(ValueError):
            common.save_uploaded_image(FakeUploadedFile("evil.HTML"))

    def test_content_does_not_have_to_match_extension(self):
        """The extension allowlist is not content/MIME sniffing -- a file
        named *.png containing arbitrary bytes (e.g. HTML) is still stored
        unchanged as long as its *extension* is allowed. Verifying this
        remains true is intentional: this task's scope is a suffix
        allowlist only, not content re-encoding/sniffing."""
        payload = b"<html><script>alert(document.cookie)</script></html>"
        rel_path = common.save_uploaded_image(FakeUploadedFile("looks_like_image.png", payload))
        saved = self.project_root / rel_path
        self.assertEqual(saved.read_bytes(), payload)

    def test_no_file_size_limit_enforced(self):
        """No size check in save_uploaded_image() -- a several-MB payload
        (kept modest here to keep the test fast) is written without
        rejection. Confirms the absence of a limit, not a DoS at scale."""
        payload = b"A" * (5 * 1024 * 1024)  # 5 MB
        rel_path = common.save_uploaded_image(FakeUploadedFile("big.jpg", payload))
        saved = self.project_root / rel_path
        self.assertEqual(saved.stat().st_size, len(payload))

    # ---------- path traversal ----------

    def test_path_traversal_via_filename_does_not_escape_upload_dir(self):
        """Path(name).suffix only ever extracts the last extension
        component -- the directory-traversal portion of a crafted name is
        discarded entirely because the final filename is always a fresh
        uuid4 + that extension, never derived from the rest of the
        original name."""
        for malicious_name in (
            "../../../etc/passwd.jpg",
            "..\\..\\..\\windows\\system32\\evil.png",
            "/etc/passwd.jpg",  # .jpg (allowed) keeps this test focused on
            "....//....//evil.jpg",  # path traversal, separate from the extension checks above
        ):
            rel_path = common.save_uploaded_image(FakeUploadedFile(malicious_name))
            saved = self.project_root / rel_path
            # must resolve to *inside* the upload dir, never escape it
            self.assertEqual(saved.resolve().parent, self.upload_dir.resolve())
            self.assertTrue(saved.exists())

    def test_absolute_path_as_filename_does_not_escape_upload_dir(self):
        # .jpg (allowed) keeps this test focused on path-traversal defense,
        # independent of the separate extension-allowlist tests above.
        rel_path = common.save_uploaded_image(FakeUploadedFile("C:\\Windows\\evil.jpg"))
        saved = self.project_root / rel_path
        self.assertEqual(saved.resolve().parent, self.upload_dir.resolve())

    def test_absolute_path_with_disallowed_extension_rejected(self):
        with self.assertRaises(ValueError):
            common.save_uploaded_image(FakeUploadedFile("C:\\Windows\\evil.exe"))
        self.assertEqual(list(self.upload_dir.iterdir()), [])

    def test_no_extension_filename_rejected(self):
        """A filename with no extension at all has suffix "" -- not in the
        allowlist, so it's now rejected rather than silently saved with an
        empty suffix (the pre-hardening behavior)."""
        with self.assertRaises(ValueError):
            common.save_uploaded_image(FakeUploadedFile("noextension"))
        self.assertEqual(list(self.upload_dir.iterdir()), [])

    # ---------- filename collisions / overwrite ----------

    def test_filenames_are_never_derived_from_original_so_no_overwrite(self):
        """Every save uses a fresh uuid4 -- two uploads with the identical
        original filename never collide/overwrite each other."""
        rel1 = common.save_uploaded_image(FakeUploadedFile("same_name.jpg", b"first"))
        rel2 = common.save_uploaded_image(FakeUploadedFile("same_name.jpg", b"second"))
        self.assertNotEqual(rel1, rel2)
        self.assertEqual((self.project_root / rel1).read_bytes(), b"first")
        self.assertEqual((self.project_root / rel2).read_bytes(), b"second")

    def test_cannot_overwrite_arbitrary_existing_project_file(self):
        """Even with a crafted name aimed at an existing project file (an
        allowed-extension decoy here, since a real target like app.py/*.py
        is now rejected by the extension allowlist before path logic even
        runs -- that's covered separately by test_py_js_txt_extensions_rejected),
        the fresh-uuid4 filename scheme means save_uploaded_image() can
        never target an existing path -- it always writes a brand-new file
        under uploads/."""
        target = self.project_root / "existing.jpg"
        target.write_bytes(b"original content")

        rel_path = common.save_uploaded_image(FakeUploadedFile("../existing.jpg"))
        saved = self.project_root / rel_path

        self.assertEqual(target.read_bytes(), b"original content")  # untouched
        self.assertNotEqual(saved, target)

    def test_py_extension_traversal_target_rejected_before_path_logic(self):
        """A traversal attempt aimed at a real .py project file is blocked
        by the extension allowlist itself -- an even earlier rejection
        point than the path-traversal defense (both hold)."""
        with self.assertRaises(ValueError):
            common.save_uploaded_image(FakeUploadedFile("../app.py"))


if __name__ == "__main__":
    unittest.main()
