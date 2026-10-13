#![cfg(windows)]

mod common;

use std::ffi::OsString;

use common::TestRepo;
use dakedaduck_svn_lib::svn::runner::{RunOptions, SvnRunner};

#[tokio::test]
async fn info_xml_of_fresh_repo_contains_info_element() {
    let repo = TestRepo::create();
    let runner = SvnRunner::new(repo.svn.path.clone());
    let args: Vec<OsString> = vec!["info".into(), "--xml".into(), repo.url.clone().into()];

    let output = runner
        .run(&args, RunOptions::default())
        .await
        .expect("svn info debe funcionar");

    assert!(String::from_utf8_lossy(&output.stdout).contains("<info>"));
}
