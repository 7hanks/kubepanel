import importlib.util,json,pathlib,unittest
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('prune_containers',pathlib.Path(__file__).with_name('prune_containers.py'))
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
class CleanupTests(unittest.TestCase):
 def test_only_owned_stopped_deployment_containers_are_removed(self):
  names=['kubepanel','database','kubepanel-rollback-20261113T010000Z','kubepanel-rollback-20261113T020000Z','kubepanel-rollback-20261113T030000Z','kubepanel-candidate-aaaaaaaaaaaa','kubepanel-rollback-unrelated']
  def output(args,**kwargs):
   if args[1]=='ps':return '\n'.join(names)
   name=args[-1];running='020000' in name;owned='030000' not in name
   return json.dumps([{'Id':name+'-id','State':{'Running':running,'Status':'running' if running else 'exited'},'Config':{'Labels':{'org.opencontainers.image.title':'KubePanel' if owned else 'Other','org.opencontainers.image.revision':'a'*40}}}])
  with patch.object(module.subprocess,'check_output',side_effect=output),patch.object(module.subprocess,'run') as run:
   removed=module.prune();self.assertEqual(removed,[names[2],names[5]])
   for call in run.call_args_list:self.assertEqual(call.args[0][:2],['docker','rm']);self.assertNotIn('--force',call.args[0]);self.assertNotIn('-v',call.args[0])
if __name__=='__main__':unittest.main()
