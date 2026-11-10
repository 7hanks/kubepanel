"""Exercise release state transitions with a fake Docker CLI, without a daemon or network."""
import importlib.util
import json
import os
import pathlib
import shutil
import subprocess
import tempfile
import unittest

DEPLOY = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('manifest', DEPLOY / 'manifest.py')
manifest = importlib.util.module_from_spec(spec)
spec.loader.exec_module(manifest)
pathlib.Path('.local').mkdir(exist_ok=True)
tempfile.tempdir = str(pathlib.Path('.local').resolve())

DOCKER = r'''#!/usr/bin/env python3
import json,os,pathlib,sys
a=sys.argv[1:]
state=pathlib.Path(os.environ['FAKE_STATE'])
with (state/'events').open('a') as f: f.write(json.dumps(a)+'\n')
def file(name): return state/name
if a[:2]==['image','inspect']:
    print(os.environ['FAKE_REVISION']); sys.exit(0)
if a[0]=='inspect':
    name=a[-1]
    if not file(name).exists(): sys.exit(1)
    print(file(name).read_text() if '-f' in a else '[]')
elif a[0]=='run':
    env_names=[a[i+1] for i,x in enumerate(a[:-1]) if x in ['-e','--env'] and '=' not in a[i+1]]
    file(a[a.index('--name')+1]+'-env').write_text(json.dumps({name:os.environ.get(name) for name in env_names}))
    file(a[a.index('--name')+1]).write_text('true'); print('container-id')
elif a[0]=='stop':
    file(a[-1]).write_text('false')
elif a[0]=='start':
    file(a[-1]).write_text('true')
elif a[0]=='rename':
    if os.environ.get('FAIL_RENAME')=='1' and a[1]=='kubepanel': sys.exit(1)
    file(a[1]).rename(file(a[2]))
elif a[0]=='rm':
    file(a[-1]).unlink(missing_ok=True)
elif a[0]=='port':
    print('127.0.0.1:18080')
'''
CURL = r'''#!/usr/bin/env python3
import json,os,sys
if os.environ.get('FAIL_PRODUCTION')=='1' and ':9090/' in sys.argv[-1]: sys.exit(22)
print(json.dumps({'revision':os.environ['FAKE_REVISION'],'sourceManifestSha256':os.environ['FAKE_MANIFEST']}))
'''


@unittest.skipUnless(os.name == 'posix' and shutil.which('bash'), 'Linux deployment behavior test')
class ReleaseTests(unittest.TestCase):
    def run_release(self, fail=False, existing=True, rename_fail=False, hook_fail=False, external_env=False, source_link=False, publish_fail=False, direct_env=False, missing_password=False):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            source, base, commands, state = [root / name for name in ['source', 'base', 'bin', 'state']]
            (source / 'deploy').mkdir(parents=True)
            for name in ['manifest.py', 'backup.sh', 'release.sh', 'verify.sh']:
                shutil.copy2(DEPLOY / name, source / 'deploy' / name)
            for directory in [base / 'data', base / 'clusters', commands, state]:
                directory.mkdir(parents=True)
            (base / 'data' / 'auth.json').write_text('{"preserve":"account"}')
            (base / 'clusters' / 'cluster.yaml').write_text('preserve kubeconfig')
            selected_env = root / 'private.env' if external_env else base / '.env'
            if not direct_env:
                selected_env.write_text('DASHBOARD_PASSWORD=never-log-this\n')
            old_source = base / 'old-source'
            old_source.mkdir()
            (old_source / 'preserved.txt').write_text('old source')
            if source_link:
                (base / 'app').symlink_to(old_source, target_is_directory=True)
            else:
                shutil.copytree(old_source, base / 'app')
            if existing:
                (state / 'kubepanel').write_text('true')
            sha = 'a' * 40
            checksum = manifest.create(source, sha)
            for name, content in [('docker', DOCKER), ('curl', CURL), ('sleep', '#!/bin/sh\nexit 0\n'), ('chown', '#!/bin/sh\nexit 0\n')]:
                file = commands / name
                file.write_text(content)
                file.chmod(0o700)
            hook = root / 'candidate-check'
            hook.write_text('#!/bin/sh\nprintf "%s" "$1" > "$FAKE_STATE/hook-url"\nexit ' + ('1' if hook_fail else '0') + '\n')
            hook.chmod(0o700)
            if publish_fail:
                mover = commands / 'mv'
                mover.write_text('#!/bin/sh\ncase "$*" in *".app-next-"*) exit 1;; esac\nexec /bin/mv "$@"\n')
                mover.chmod(0o700)
            env = {**os.environ, 'PATH': str(commands) + os.pathsep + os.environ['PATH'], 'BASE_DIR': str(base), 'BACKUP_ROOT': str(root / 'backups'), 'ENV_FILE': str(selected_env), 'CANDIDATE_CHECK': str(hook), 'FAKE_STATE': str(state), 'FAKE_REVISION': sha, 'FAKE_MANIFEST': checksum, 'FAIL_PRODUCTION': str(int(fail)), 'FAIL_RENAME': str(int(rename_fail))}
            if direct_env:
                env.pop('ENV_FILE', None)
                env['DASHBOARD_PASSWORD']='' if missing_password else 'never-log-this'
                env['DASHBOARD_USERNAME']='fixture-admin'
                env['DASHBOARD_SECRET']='fixture-signing-key-keep-across-upgrades'
                env['TRUST_PROXY']='false'
            process = subprocess.run(['bash', str(source / 'deploy' / 'release.sh'), str(source)], env=env, text=True, capture_output=True, timeout=40)
            self.assertNotIn('never-log-this', process.stdout + process.stderr)
            self.assertEqual((base / 'data' / 'auth.json').read_text(), '{"preserve":"account"}')
            self.assertEqual((base / 'clusters' / 'cluster.yaml').read_text(), 'preserve kubeconfig')
            if missing_password:
                self.assertNotEqual(process.returncode, 0)
                self.assertIn('DASHBOARD_PASSWORD', process.stderr)
                self.assertFalse((state / 'events').exists(), 'Reject missing credentials before touching Docker')
                return
            if direct_env:
                self.assertEqual(process.returncode, 0, process.stderr)
            events = [json.loads(line) for line in (state / 'events').read_text().splitlines()]
            if external_env:
                saved = list((root / 'backups').glob('*/deployment.env'))
                self.assertTrue(saved, 'Selected external environment must be backed up')
                self.assertEqual(saved[0].read_text(), 'DASHBOARD_PASSWORD=never-log-this\n')
                self.assertEqual(saved[0].stat().st_mode & 0o777, 0o600)
            if fail or rename_fail or hook_fail or publish_fail:
                self.assertNotEqual(process.returncode, 0)
                self.assertEqual((base / 'app' / 'preserved.txt').read_text(), 'old source')
                if existing:
                    self.assertEqual((state / 'kubepanel').read_text(), 'true')
                    if fail:
                        self.assertTrue(any(event[0] == 'rename' and event[-1] == 'kubepanel' for event in events))
                else:
                    self.assertFalse((state / 'kubepanel').exists(), process.stderr)
            else:
                self.assertEqual(process.returncode, 0, process.stderr)
                self.assertEqual((state / 'kubepanel').read_text(), 'true')
                self.assertTrue(list(state.glob('kubepanel-rollback-*')))
                candidate = next(event for event in events if event[0] == 'run' and 'kubepanel-candidate-' in ' '.join(event))
                self.assertIn('127.0.0.1::8080', candidate)
                self.assertNotIn(str(base / 'data') + ':/app/data', candidate)
                production = next(event for event in events if event[0] == 'run' and event[event.index('--name') + 1] == 'kubepanel')
                self.assertIn(str(base / 'data') + ':/app/data', production)
                self.assertEqual((state / 'hook-url').read_text(), 'http://127.0.0.1:18080')
                self.assertTrue((base / 'app').is_symlink())
                self.assertEqual((base / 'app').resolve(), base / 'releases' / sha)
                self.assertEqual(manifest.verify(base / 'app'), checksum)
                if direct_env:
                    for event in [candidate, production]:
                        self.assertNotIn('--env-file', event)
                        self.assertNotIn('never-log-this', ' '.join(event))
                        supplied=json.loads((state / (event[event.index('--name')+1]+'-env')).read_text())
                        self.assertEqual(supplied['DASHBOARD_PASSWORD'], 'never-log-this')
                        self.assertEqual(supplied['DASHBOARD_USERNAME'], 'fixture-admin')
                        self.assertEqual(supplied['DASHBOARD_SECRET'], 'fixture-signing-key-keep-across-upgrades')
                        self.assertEqual(supplied['TRUST_PROXY'], 'false')
                if not source_link:
                    self.assertEqual(next(base.glob('source-rollback-*')).joinpath('preserved.txt').read_text(), 'old source')
            if hook_fail:
                self.assertEqual((state / 'hook-url').read_text(), 'http://127.0.0.1:18080')
                self.assertFalse(any(event[0] == 'rename' for event in events))

    def test_success_retains_old_container_and_isolates_candidate_data(self):
        self.run_release()

    def test_failed_production_check_restarts_original_container(self):
        self.run_release(fail=True)

    def test_failed_new_install_removes_failed_container(self):
        self.run_release(fail=True, existing=False)

    def test_failed_rename_restarts_stopped_original_container(self):
        self.run_release(rename_fail=True)

    def test_explicit_external_environment_is_privately_backed_up(self):
        self.run_release(external_env=True)

    def test_failed_candidate_hook_does_not_promote_production(self):
        self.run_release(hook_fail=True)

    def test_subsequent_release_atomically_replaces_source_symlink(self):
        self.run_release(source_link=True)

    def test_failed_source_publication_restores_original_directory_and_container(self):
        self.run_release(publish_fail=True)

    def test_direct_password_deployment_needs_no_environment_file(self):
        self.run_release(direct_env=True)

    def test_missing_direct_password_is_rejected_before_docker(self):
        self.run_release(direct_env=True, missing_password=True)


if __name__ == '__main__':
    unittest.main()
