use std::collections::HashMap;
use std::collections::hash_map::Entry;
use std::sync::Arc;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};

use super::Cancel;
use crate::app::operations::locked;

#[derive(Default)]
pub struct ArchiveTasks {
    running: Mutex<HashMap<u64, Cancel>>,
}

impl ArchiveTasks {
    pub fn begin(&self, id: u64) -> Option<Cancel> {
        match locked(&self.running).entry(id) {
            Entry::Occupied(_) => None,
            Entry::Vacant(slot) => Some(slot.insert(Arc::new(AtomicBool::new(false))).clone()),
        }
    }

    pub fn cancel(&self, id: u64) -> bool {
        let cancel = locked(&self.running).get(&id).cloned();
        cancel.is_some_and(|flag| {
            flag.store(true, Ordering::Relaxed);
            true
        })
    }

    pub fn finish(&self, id: u64) {
        locked(&self.running).remove(&id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_task_id_can_only_run_once_at_a_time() {
        let tasks = ArchiveTasks::default();
        let first = tasks.begin(1).expect("libre");
        assert!(tasks.begin(1).is_none());
        assert!(tasks.begin(2).is_some());
        assert!(!first.load(Ordering::Relaxed));
    }

    #[test]
    fn cancel_flags_only_the_named_running_task() {
        let tasks = ArchiveTasks::default();
        let one = tasks.begin(1).unwrap();
        let two = tasks.begin(2).unwrap();
        assert!(tasks.cancel(1));
        assert!(one.load(Ordering::Relaxed) && !two.load(Ordering::Relaxed));
        assert!(!tasks.cancel(99));
    }

    #[test]
    fn a_finished_task_is_forgotten_and_its_id_is_reusable() {
        let tasks = ArchiveTasks::default();
        tasks.begin(1).unwrap();
        tasks.finish(1);
        assert!(!tasks.cancel(1));
        assert!(tasks.begin(1).is_some());
    }
}
