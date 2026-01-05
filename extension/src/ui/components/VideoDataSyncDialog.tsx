import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import CloseIcon from '@mui/icons-material/Close';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import Grid from '@mui/material/Grid';
import IconButton from '@mui/material/IconButton';
import SettingsIcon from '@mui/icons-material/Settings';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import makeStyles from '@mui/styles/makeStyles';
import MiniProfileSelector from '@project/common/components/MiniProfileSelector';
import type { Profile } from '@project/common/settings';
import Alert from '@mui/material/Alert';
import Link from '@mui/material/Link';
import { type ButtonBaseActions } from '@mui/material';
import { Theme } from '@mui/material/styles';
import { ConfirmedVideoDataSubtitleTrack, VideoDataSubtitleTrack, VideoDataUiOpenReason } from '@project/common';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

const createClasses = makeStyles((theme: Theme) => ({
    relative: {
        position: 'relative',
    },
    spinner: {
        position: 'absolute',
        right: 'calc(1em + 14px)',
        top: 'calc(50% - 13px)',
        fontSize: '1.5em',
    },
    hide: {
        display: 'none',
    },
    debugBox: {
        marginTop: theme.spacing(2),
        padding: theme.spacing(1),
        backgroundColor: theme.palette.action.hover,
        borderRadius: 4,
        maxHeight: 150,
        overflowY: 'auto',
        fontSize: '0.75rem',
        whiteSpace: 'pre-wrap',
        fontFamily: 'monospace',
        border: `1px solid ${theme.palette.divider}`,
    },
    dialogPaper: {
        height: 800,
        maxHeight: '90%',
    },
}));

function calculateVideoName(baseName: string, label: string, localFile: boolean | undefined) {
    if (baseName === '' && label) {
        return label;
    }
    if (label && !baseName.includes(label) && localFile !== true) {
        return `${baseName} - ${label}`;
    }
    return baseName;
}

interface Props {
    open: boolean;
    disabled: boolean;
    isLoading: boolean;
    suggestedName: string;
    showSubSelect: boolean;
    subtitleTracks: VideoDataSubtitleTrack[];
    selectedSubtitleTrackIds: string[];
    defaultCheckboxState: boolean;
    error: string;
    openReason: VideoDataUiOpenReason;
    profiles: Profile[];
    activeProfile?: string;
    hasSeenFtue?: boolean;
    hideRememberTrackPreferenceToggle?: boolean;
    episode: number | '';
    onSearch: (title: string, episode: number | '') => void;
    onCancel: () => void;
    onOpenFile: (track?: number) => void;
    onOpenSettings: () => void;
    onConfirm: (track: ConfirmedVideoDataSubtitleTrack[], shouldRememberTrackChoices: boolean) => void;
    onSetActiveProfile: (profile: string | undefined) => void;
    onDismissFtue: () => void;
    isAnimeSite: boolean;
    debugInfo?: string;
    apiKey?: string;
    onApiKeyChange?: (key: string) => void;
}

export default function VideoDataSyncDialog({
    open,
    disabled,
    isLoading,
    suggestedName,
    showSubSelect,
    subtitleTracks,
    selectedSubtitleTrackIds,
    defaultCheckboxState,
    error,
    openReason,
    profiles,
    activeProfile,
    hasSeenFtue,
    hideRememberTrackPreferenceToggle,
    episode: initialEpisode,
    onSearch,
    onCancel,
    onOpenFile,
    onOpenSettings,
    onConfirm,
    onSetActiveProfile,
    onDismissFtue,
    isAnimeSite,
    debugInfo,
    apiKey,
    onApiKeyChange,
}: Props) {
    const { t } = useTranslation();
    const [userSelectedSubtitleTrackIds, setUserSelectedSubtitleTrackIds] = useState(['-', '-', '-']);
    const [name, setName] = useState('');
    const trimmedName = name.trim();
    const classes = createClasses();
    const [localEpisode, setLocalEpisode] = useState(initialEpisode);
    const [localApiKey, setLocalApiKey] = useState(apiKey || '');
    const [apiKeyError, setApiKeyError] = useState(false);
    const [subtitleSelectionError, setSubtitleSelectionError] = useState(false);
    const errorRef = useRef<HTMLDivElement>(null);
    const apiKeyRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (open) {
            setUserSelectedSubtitleTrackIds(
                selectedSubtitleTrackIds.map((id) => {
                    return id !== undefined ? id : '-';
                })
            );
            setApiKeyError(false);
            setSubtitleSelectionError(false);
        } else if (!open) {
            setName('');
        }
    }, [open, selectedSubtitleTrackIds]);

    useEffect(() => {
        if (apiKey !== undefined) {
            setLocalApiKey(apiKey);
        }
    }, [apiKey]);

    useEffect(() => {
        setName((name) => {
            if (localEpisode !== '') {
                return name || suggestedName;
            }
            if (!subtitleTracks) {
                return name;
            }
            if (
                !name ||
                name === suggestedName ||
                subtitleTracks.find(
                    (track) =>
                        track.url !== '-' && name === calculateVideoName(suggestedName, track.label, track.localFile)
                )
            ) {
                const selectedTrack = subtitleTracks.find((track) => track.id === userSelectedSubtitleTrackIds[0]);
                if (selectedTrack === undefined || selectedTrack.url === '-') {
                    return suggestedName;
                }
                return calculateVideoName(suggestedName, selectedTrack.label, selectedTrack.localFile);
            }
            return name;
        });

        setLocalEpisode((prev) => {
            if (prev === '') {
                return initialEpisode;
            }
            return prev;
        });
    }, [suggestedName, userSelectedSubtitleTrackIds, subtitleTracks, initialEpisode, localEpisode]);

    // Scroll to subtitle error when state changes
    useEffect(() => {
        if (subtitleSelectionError && errorRef.current) {
            errorRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }, [subtitleSelectionError]);

    // Scroll to API key error when state changes
    useEffect(() => {
        if (apiKeyError && apiKeyRef.current) {
            apiKeyRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }, [apiKeyError]);

    function handleOkButtonClick() {
        if (isAnimeSite && !localApiKey) {
            setApiKeyError(true);
            // Manually scroll if error is already present (useEffect won't fire)
            if (apiKeyError && apiKeyRef.current) {
                apiKeyRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
            return;
        }

        if (userSelectedSubtitleTrackIds[0] === '-') {
            setSubtitleSelectionError(true);
            // Manually scroll if error is already present (useEffect won't fire)
            if (subtitleSelectionError && errorRef.current) {
                errorRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
            return;
        }

        const selectedSubtitleTracks: ConfirmedVideoDataSubtitleTrack[] = allSelectedSubtitleTracks();
        onConfirm(selectedSubtitleTracks, true);
    }

    function allSelectedSubtitleTracks() {
        const selectedSubtitleTracks: ConfirmedVideoDataSubtitleTrack[] = userSelectedSubtitleTrackIds
            .map((selected): ConfirmedVideoDataSubtitleTrack | undefined => {
                const subtitle = subtitleTracks.find((subtitle) => subtitle.id === selected);
                if (subtitle) {
                    const { localFile, label } = subtitle;
                    const trackName = localFile
                        ? label.substring(0, label.lastIndexOf('.'))
                        : calculateVideoName(trimmedName, label, localFile);

                    return {
                        name: trackName,
                        ...subtitle,
                    };
                }
            })
            .filter((track): track is ConfirmedVideoDataSubtitleTrack => track !== undefined);

        return selectedSubtitleTracks;
    }

    function generateSubtitleTrackSelectors(numberOfSubtitleTrackSelectors: number) {
        const subtitleTrackSelectors = [];
        for (let i = 0; i < numberOfSubtitleTrackSelectors; i++) {
            subtitleTrackSelectors.push(
                <Grid item key={i} style={{ width: '100%' }}>
                    <div className={`${classes.relative}${!showSubSelect ? ` ${classes.hide}` : ''}`}>
                        <TextField
                            select
                            fullWidth
                            key={i}
                            error={!!error}
                            color="primary"
                            variant="filled"
                            label={`${t('extension.videoDataSync.subtitleTrack')}`}
                            helperText={error || ''}
                            value={
                                subtitleTracks.find((track) => track.id === userSelectedSubtitleTrackIds[i])?.id ?? '-'
                            }
                            disabled={isLoading || disabled}
                            onChange={(e) =>
                                setUserSelectedSubtitleTrackIds((prevSelectedSubtitles) => {
                                    const newSelectedSubtitles = [...prevSelectedSubtitles];
                                    newSelectedSubtitles[i] = e.target.value;
                                    setSubtitleSelectionError(false);
                                    return newSelectedSubtitles;
                                })
                            }
                        >
                            {subtitleTracks.map((subtitle) => (
                                <MenuItem value={subtitle.id} key={subtitle.id}>
                                    {subtitle.label}
                                </MenuItem>
                            ))}
                            <MenuItem onClick={() => onOpenFile(i)}>{t('action.openFiles')}</MenuItem>
                        </TextField>
                        {isLoading && (
                            <span className={classes.spinner}>
                                <CircularProgress size={20} color="primary" />
                            </span>
                        )}
                    </div>
                </Grid>
            );
        }
        return subtitleTrackSelectors;
    }

    const singleSubtitleTrackSelector = generateSubtitleTrackSelectors(1);
    const okActionRef = useRef<ButtonBaseActions | null>(null);
    const videoNameRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (open && trimmedName && !videoNameRef.current?.contains(document.activeElement) && !disabled) {
            okActionRef.current?.focusVisible();
        }
    }, [open, trimmedName, disabled]);

    const handleEpisodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setLocalEpisode(e.target.value === '' ? '' : parseInt(e.target.value));
    };

    const handleApiKeyChangeInternal = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value;
        setLocalApiKey(val);
        if (val) setApiKeyError(false);
        onApiKeyChange?.(val);
    };

    const isSearchDisabled = isLoading || !localEpisode || !name;

    const handleSearch = () => {
        if (!localApiKey) {
            setApiKeyError(true);
            return;
        }
        setSubtitleSelectionError(false);
        onSearch(name, localEpisode);
    };

    return (
        <Dialog
            disableRestoreFocus
            disableEnforceFocus
            fullWidth
            maxWidth="sm"
            open={open}
            onClose={onCancel}
            classes={{ paper: classes.dialogPaper }}
        >
            <Toolbar>
                <Typography variant="h6" style={{ flexGrow: 1 }}>
                    {t('extension.videoDataSync.selectSubtitles')}
                </Typography>
                <MiniProfileSelector
                    profiles={profiles}
                    activeProfile={activeProfile}
                    onSetActiveProfile={onSetActiveProfile}
                />
                {onOpenSettings && (
                    <IconButton edge="end" onClick={onOpenSettings}>
                        <SettingsIcon />
                    </IconButton>
                )}
                {onCancel && (
                    <IconButton edge="end" onClick={() => onCancel()}>
                        <CloseIcon />
                    </IconButton>
                )}
            </Toolbar>
            <DialogContent>
                {openReason === VideoDataUiOpenReason.miningCommand && (
                    <DialogContentText>{t('extension.videoDataSync.loadSubtitlesFirst')}</DialogContentText>
                )}
                {openReason === VideoDataUiOpenReason.failedToAutoLoadPreferredTrack && (
                    <DialogContentText>
                        {isAnimeSite
                            ? 'Could not find a subtitle from your preferred provider for this episode.'
                            : t('extension.videoDataSync.failedToAutoLoad')}
                    </DialogContentText>
                )}
                <form>
                    <Grid container direction="column" spacing={2}>
                        <Grid item>
                            <TextField
                                ref={videoNameRef}
                                fullWidth
                                multiline
                                color="primary"
                                variant="filled"
                                label={t('extension.videoDataSync.videoName')}
                                value={name}
                                disabled={disabled}
                                onChange={(e) => setName(e.target.value)}
                            />
                        </Grid>
                        {isAnimeSite && (
                            <>
                                <Grid item ref={apiKeyRef}>
                                    <TextField
                                        fullWidth
                                        label="Jimaku API Key"
                                        value={localApiKey}
                                        onChange={handleApiKeyChangeInternal}
                                        margin="normal"
                                        variant="outlined"
                                        type="text"
                                        error={apiKeyError}
                                        helperText={
                                            <div style={{ textAlign: 'left', lineHeight: '1.4' }}>
                                                {apiKeyError && (
                                                    <Typography
                                                        variant="caption"
                                                        color="error"
                                                        display="block"
                                                        style={{ marginBottom: 4, fontWeight: 'bold' }}
                                                    >
                                                        API Key is required to fetch subtitles.
                                                    </Typography>
                                                )}
                                                <Typography variant="caption" display="block">
                                                    Get an API key from{' '}
                                                    <Link href="https://jimaku.cc" target="_blank" rel="noopener">
                                                        jimaku.cc
                                                    </Link>
                                                </Typography>
                                                <Typography variant="caption" display="block" style={{ marginLeft: 8 }}>
                                                    1. You can get a free key by signing up on the site:{' '}
                                                    <Link
                                                        href="https://jimaku.cc/account"
                                                        target="_blank"
                                                        rel="noopener"
                                                    >
                                                        https://jimaku.cc/account
                                                    </Link>
                                                </Typography>
                                                <Typography variant="caption" display="block" style={{ marginLeft: 8 }}>
                                                    2. Generate an API key under the &quot;API&quot; heading and copy it
                                                </Typography>
                                            </div>
                                        }
                                    />
                                </Grid>
                                <Grid item>
                                    <TextField
                                        fullWidth
                                        label={t('extension.videoDataSync.episode')}
                                        value={localEpisode}
                                        onChange={handleEpisodeChange}
                                        margin="normal"
                                        variant="outlined"
                                        type="number"
                                    />
                                </Grid>
                            </>
                        )}
                        {singleSubtitleTrackSelector}

                        {subtitleSelectionError && (
                            <Grid item ref={errorRef}>
                                <Alert severity="warning">
                                    {isAnimeSite
                                        ? "No subtitle selected. Please click 'Search' to find subtitles."
                                        : 'Please select a subtitle track.'}
                                </Alert>
                            </Grid>
                        )}

                        {isAnimeSite && (
                            <Grid item>
                                <Button onClick={handleSearch} disabled={isSearchDisabled}>
                                    {t('extension.videoDataSync.search')}
                                </Button>
                            </Grid>
                        )}
                        {debugInfo && (
                            <Grid item>
                                <div className={classes.debugBox}>{debugInfo}</div>
                            </Grid>
                        )}
                    </Grid>
                </form>
            </DialogContent>
            <DialogActions>
                <Button disabled={disabled} onClick={() => onOpenFile()}>
                    {t('action.openFiles')}
                </Button>
                <Button action={okActionRef} disabled={!trimmedName || disabled} onClick={handleOkButtonClick}>
                    {t('action.ok')}
                </Button>
            </DialogActions>
        </Dialog>
    );
}
