use serde::Serialize;

const ITEM_PREFIX_LEN: usize = 5;
const ITEM_SEPARATOR_INDEX: usize = 4;
const PROPS_COLUMN_CODES: &[u8] = b" UCGM";
const LOCK_COLUMN_CODES: &[u8] = b" B";
const TREE_CONFLICT_COLUMN_CODES: &[u8] = b" C";
const TRANSMITTING_VERB: &str = "Transmitting";
const COMMIT_VERBS: [(&str, ProgressAction); 4] = [
    ("Sending", ProgressAction::Sending),
    ("Adding", ProgressAction::Added),
    ("Deleting", ProgressAction::Deleted),
    ("Replacing", ProgressAction::Replaced),
];
const REVISION_PREFIXES: [&str; 4] = [
    "Updated to revision ",
    "Checked out revision ",
    "Committed revision ",
    "At revision ",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ProgressAction {
    Added,
    Deleted,
    Updated,
    Conflicted,
    Merged,
    Existed,
    Replaced,
    Broken,
    Sending,
    Transmitting,
    Other,
}

impl ProgressAction {
    fn from_column(code: u8) -> Self {
        match code {
            b'A' => Self::Added,
            b'D' => Self::Deleted,
            b'U' => Self::Updated,
            b'C' => Self::Conflicted,
            b'G' => Self::Merged,
            b'E' => Self::Existed,
            b'R' => Self::Replaced,
            b'B' => Self::Broken,
            _ => Self::Other,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", content = "data", rename_all = "snake_case")]
pub enum ProgressEvent {
    Item {
        action: ProgressAction,
        path: String,
    },
    Revision {
        revision: u64,
    },
    Other(String),
}

pub fn parse_progress_line(line: &str) -> ProgressEvent {
    let line = line.trim_end_matches(['\r', '\n']);
    parse_revision(line)
        .map(|revision| ProgressEvent::Revision { revision })
        .or_else(|| parse_commit_item(line))
        .or_else(|| parse_update_item(line))
        .unwrap_or_else(|| ProgressEvent::Other(line.to_string()))
}

pub fn last_revision(output: &str) -> Option<u64> {
    output.lines().filter_map(parse_revision).next_back()
}

fn parse_revision(line: &str) -> Option<u64> {
    let digits = REVISION_PREFIXES
        .iter()
        .find_map(|prefix| line.trim().strip_prefix(prefix))?;
    digits.trim_end_matches('.').parse().ok()
}

fn parse_commit_item(line: &str) -> Option<ProgressEvent> {
    if let Some(rest) = line.strip_prefix(TRANSMITTING_VERB) {
        return rest
            .starts_with(' ')
            .then(|| item(ProgressAction::Transmitting, rest));
    }
    COMMIT_VERBS.iter().find_map(|(verb, action)| {
        let rest = line.strip_prefix(verb)?;
        rest.starts_with(' ').then(|| item(*action, rest))
    })
}

fn parse_update_item(line: &str) -> Option<ProgressEvent> {
    let bytes = line.as_bytes();
    if bytes.len() <= ITEM_PREFIX_LEN || bytes[ITEM_SEPARATOR_INDEX] != b' ' {
        return None;
    }
    let action_column = bytes[0];
    let props_column = bytes[1];
    let is_known_layout = (action_column == b' ' || action_column.is_ascii_uppercase())
        && PROPS_COLUMN_CODES.contains(&props_column)
        && LOCK_COLUMN_CODES.contains(&bytes[2])
        && TREE_CONFLICT_COLUMN_CODES.contains(&bytes[3]);
    let code = if action_column == b' ' {
        props_column
    } else {
        action_column
    };
    if !is_known_layout || code == b' ' {
        return None;
    }
    let path = line.get(ITEM_PREFIX_LEN..)?;
    Some(item(ProgressAction::from_column(code), path))
}

fn item(action: ProgressAction, path: &str) -> ProgressEvent {
    ProgressEvent::Item {
        action,
        path: path.trim().to_string(),
    }
}
