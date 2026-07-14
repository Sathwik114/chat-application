import os
import tempfile
from django.test import SimpleTestCase, override_settings


@override_settings(MEDIA_ROOT=tempfile.mkdtemp())
class MediaInlineServingTests(SimpleTestCase):
    def test_media_url_serves_files_inline(self):
        media_root = tempfile.mkdtemp()
        test_file_path = os.path.join(media_root, 'sample.pdf')
        with open(test_file_path, 'wb') as fh:
            fh.write(b'%PDF-1.4\n%test pdf content')

        with override_settings(MEDIA_ROOT=media_root):
            response = self.client.get('/media/sample.pdf')

        self.assertEqual(response.status_code, 200)
        self.assertIn('inline', response.headers.get('Content-Disposition', '').lower())
