import {
  AnnotationTool,
  annotation,
  drawing,
  utilities as csUtils,
} from '@cornerstonejs/tools';
import { getEnabledElement } from '@cornerstonejs/core';
import { vec3, vec2 } from 'gl-matrix';

const { drawLine, drawTextBox, drawHandles } = drawing;

// Re-using common enums natively to avoid deep imports
const Events = {
  MOUSE_UP: 'CORNERSTONE_TOOLS_MOUSE_UP',
  MOUSE_DRAG: 'CORNERSTONE_TOOLS_MOUSE_DRAG',
  MOUSE_MOVE: 'CORNERSTONE_TOOLS_MOUSE_MOVE',
  MOUSE_CLICK: 'CORNERSTONE_TOOLS_MOUSE_CLICK',
  TOUCH_TAP: 'CORNERSTONE_TOOLS_TOUCH_TAP',
  TOUCH_END: 'CORNERSTONE_TOOLS_TOUCH_END',
  TOUCH_DRAG: 'CORNERSTONE_TOOLS_TOUCH_DRAG',
};

const ChangeTypes = {
  HandlesUpdated: 'HandlesUpdated',
  StatsUpdated: 'StatsUpdated',
  History: 'History',
};

class FlatfootMeasurementTool extends AnnotationTool {
  static toolName = 'FlatfootMeasurement';

  angleStartedNotYetCompleted: boolean;

  constructor(
    toolProps = {},
    defaultToolProps = {
      supportedInteractionTypes: ['Mouse', 'Touch'],
      configuration: {
        shadow: true,
        preventHandleOutsideImage: false,
      },
    }
  ) {
    super(toolProps, defaultToolProps);
    this.isDrawing = false;
    this.angleStartedNotYetCompleted = false;
  }

  addNewAnnotation = (evt: any, interactionType: any) => {
    if (this.angleStartedNotYetCompleted) {
        return;
    }
    this.angleStartedNotYetCompleted = true;

    const eventDetail = evt.detail;
    const { currentPoints, element } = eventDetail;
    const worldPos = currentPoints.world;

    this.isDrawing = true;

    const anno = (this as any).createAnnotation(evt, [
      [worldPos[0], worldPos[1], worldPos[2]] as [number, number, number], // A (start)
      [worldPos[0], worldPos[1], worldPos[2]] as [number, number, number], // B (current moving)
    ]);

    annotation.state.addAnnotation(anno, element);

    const viewportIdsToRender = [eventDetail.viewportId];
    this.editData = {
        annotation: anno,
        viewportIdsToRender,
        handleIndex: 1,
        movingTextBox: false,
        newAnnotation: true,
        hasMoved: false,
    };

    this._activateDraw(element);
    evt.preventDefault();
    csUtils.triggerAnnotationRenderForViewportIds(viewportIdsToRender);

    return anno;
  };

  _endCallback = (evt: any) => {
    const eventDetail = evt.detail;
    const { element } = eventDetail;
    const { annotation: anno, viewportIdsToRender, newAnnotation, hasMoved } = this.editData;
    const { data } = anno;

    if (newAnnotation && !hasMoved) {
        return;
    }

    if (this.angleStartedNotYetCompleted && data.handles.points.length === 2) {
        // First click finishes point B, spawns point C
        this.editData.handleIndex = 2;
        return;
    }

    // Finished
    this.angleStartedNotYetCompleted = false;
    data.handles.activeHandleIndex = null;
    this._deactivateModify(element);
    this._deactivateDraw(element);

    csUtils.triggerAnnotationRenderForViewportIds(viewportIdsToRender);

    this.editData = null;
    this.isDrawing = false;
  };

  _dragCallback = (evt: any) => {
    this.isDrawing = true;
    const eventDetail = evt.detail;
    const { element } = eventDetail;
    const { annotation: anno, viewportIdsToRender, handleIndex, movingTextBox } = this.editData;
    const { data } = anno;

    if (movingTextBox) {
        const { deltaPoints } = eventDetail;
        const worldPosDelta = deltaPoints.world;
        const { textBox } = data.handles;
        const { worldPosition } = textBox;
        worldPosition[0] += worldPosDelta[0];
        worldPosition[1] += worldPosDelta[1];
        worldPosition[2] += worldPosDelta[2];
        textBox.hasMoved = true;
    } else if (handleIndex === undefined) {
        const { deltaPoints } = eventDetail;
        const worldPosDelta = deltaPoints.world;
        const points = data.handles.points;
        points.forEach((point: any) => {
            point[0] += worldPosDelta[0];
            point[1] += worldPosDelta[1];
            point[2] += worldPosDelta[2];
        });
        anno.invalidated = true;
    } else {
        const { currentPoints } = eventDetail;
        const worldPos = currentPoints.world;
        data.handles.points[handleIndex] = [...worldPos];
        anno.invalidated = true;
    }

    this.editData.hasMoved = true;
    csUtils.triggerAnnotationRenderForViewportIds(viewportIdsToRender);
  };

  /**
   * Calculate distance from Point C to Line AB
   */
  _calculateArchHeight(pointA: any, pointB: any, pointC: any) {
    const ab = vec3.sub(vec3.create(), pointB as vec3, pointA as vec3);
    const ac = vec3.sub(vec3.create(), pointC as vec3, pointA as vec3);
    const abLength = vec3.length(ab);
    if (abLength === 0) return 0;

    const cross = vec3.cross(vec3.create(), ab, ac);
    const distance = vec3.length(cross) / abLength;
    return distance; // Returns world units (e.g., mm)
  }

  /**
   * Calculate the angle ACB
   */
  _calculateArchAngle(pointA: any, pointB: any, pointC: any) {
    const ca = vec3.sub(vec3.create(), pointA as vec3, pointC as vec3);
    const cb = vec3.sub(vec3.create(), pointB as vec3, pointC as vec3);

    const dot = vec3.dot(ca, cb);
    const magCA = vec3.length(ca);
    const magCB = vec3.length(cb);

    if (magCA === 0 || magCB === 0) return 0;

    const angleRad = Math.acos(dot / (magCA * magCB));
    return angleRad * (180 / Math.PI);
  }

  isPointNearTool = (element: any, anno: any, canvasCoords: any, proximity: any) => {
    const enabledElement = getEnabledElement(element);
    if (!enabledElement) return false;
    const { viewport } = enabledElement;
    const { data } = anno;
    const points = data.handles.points;
    if (!points || points.length < 2) return false;

    // Check baseline distance
    const canvasPoint1 = viewport.worldToCanvas(points[0]);
    const canvasPoint2 = viewport.worldToCanvas(points[1]);
    const dist1 = vec2.distance([canvasCoords[0], canvasCoords[1]], canvasPoint1);
    const dist2 = vec2.distance([canvasCoords[0], canvasCoords[1]], canvasPoint2);
    if (dist1 <= proximity || dist2 <= proximity) return true;

    if (points[2]) {
        const canvasPoint3 = viewport.worldToCanvas(points[2]);
        const dist3 = vec2.distance([canvasCoords[0], canvasCoords[1]], canvasPoint3);
        if (dist3 <= proximity) return true;
    }

    return false;
  };

  toolSelectedCallback = (evt: any, anno: any, interactionType: any) => {
    const eventDetail = evt.detail;
    const { element } = eventDetail;
    anno.highlighted = true;
    const viewportIdsToRender = [eventDetail.viewportId];
    this.editData = {
        annotation: anno,
        viewportIdsToRender,
        movingTextBox: false,
    };
    this._activateModify(element);
    csUtils.triggerAnnotationRenderForViewportIds(viewportIdsToRender);
    evt.preventDefault();
  };

  cancel = (element: any) => {
    if (this.isDrawing) {
        this.isDrawing = false;
        this._deactivateDraw(element);
        this._deactivateModify(element);

        const { annotation: anno, viewportIdsToRender } = this.editData;
        anno.highlighted = false;
        anno.data.handles.activeHandleIndex = null;
        csUtils.triggerAnnotationRenderForViewportIds(viewportIdsToRender);
        this.editData = null;
        this.angleStartedNotYetCompleted = false;
        return anno.annotationUID;
    }
    return null;
  };

  handleSelectedCallback = (evt: any, anno: any, handle: any, interactionType: any) => {
    const eventDetail = evt.detail;
    const { element } = eventDetail;
    const { data } = anno;
    anno.highlighted = true;

    let movingTextBox = false;
    let handleIndex;

    if (handle.worldPosition) {
        movingTextBox = true;
    } else {
        handleIndex = data.handles.points.findIndex((p: any) => p === handle);
    }

    const viewportIdsToRender = [eventDetail.viewportId];
    this.editData = {
        annotation: anno,
        viewportIdsToRender,
        handleIndex,
        movingTextBox,
    };
    this._activateModify(element);
    csUtils.triggerAnnotationRenderForViewportIds(viewportIdsToRender);
    evt.preventDefault();
  };

  _activateModify = (element: any) => {
    element.addEventListener(Events.MOUSE_UP, this._endCallback);
    element.addEventListener(Events.MOUSE_DRAG, this._dragCallback);
    element.addEventListener(Events.MOUSE_CLICK, this._endCallback);
    element.addEventListener(Events.TOUCH_TAP, this._endCallback);
    element.addEventListener(Events.TOUCH_END, this._endCallback);
    element.addEventListener(Events.TOUCH_DRAG, this._dragCallback);
  };

  _deactivateModify = (element: any) => {
    element.removeEventListener(Events.MOUSE_UP, this._endCallback);
    element.removeEventListener(Events.MOUSE_DRAG, this._dragCallback);
    element.removeEventListener(Events.MOUSE_CLICK, this._endCallback);
    element.removeEventListener(Events.TOUCH_TAP, this._endCallback);
    element.removeEventListener(Events.TOUCH_END, this._endCallback);
    element.removeEventListener(Events.TOUCH_DRAG, this._dragCallback);
  };

  _activateDraw = (element: any) => {
    element.addEventListener(Events.MOUSE_UP, this._endCallback);
    element.addEventListener(Events.MOUSE_DRAG, this._dragCallback);
    element.addEventListener(Events.MOUSE_MOVE, this._dragCallback);
    element.addEventListener(Events.MOUSE_CLICK, this._endCallback);
    element.addEventListener(Events.TOUCH_TAP, this._endCallback);
    element.addEventListener(Events.TOUCH_END, this._endCallback);
    element.addEventListener(Events.TOUCH_DRAG, this._dragCallback);
  };

  _deactivateDraw = (element: any) => {
    element.removeEventListener(Events.MOUSE_UP, this._endCallback);
    element.removeEventListener(Events.MOUSE_DRAG, this._dragCallback);
    element.removeEventListener(Events.MOUSE_MOVE, this._dragCallback);
    element.removeEventListener(Events.MOUSE_CLICK, this._endCallback);
    element.removeEventListener(Events.TOUCH_TAP, this._endCallback);
    element.removeEventListener(Events.TOUCH_END, this._endCallback);
    element.removeEventListener(Events.TOUCH_DRAG, this._dragCallback);
  };

  // Renders the annotations
  renderAnnotation = (enabledElement: any, svgDrawingHelper: any) => {
    let renderStatus = false;
    const { viewport } = enabledElement;
    const { element } = viewport;
    const annotations = annotation.state.getAnnotations(this.getToolName(), element);

    if (!annotations?.length) return renderStatus;

    for (let i = 0; i < annotations.length; i++) {
        const anno = annotations[i];
        const { annotationUID, data } = anno;
        const { points, activeHandleIndex } = data.handles;

        if (points.length < 2) continue;

        // Convert world to canvas
        const canvasCoordinates = points.map((p: any) => viewport.worldToCanvas(p));
        const canvasA = canvasCoordinates[0];
        const canvasB = canvasCoordinates[1];

        // Ensure proper line widths and colors depending on state
        const color = anno.highlighted ? 'rgb(0, 255, 0)' : 'yellow';
        const lineWidth = 2;
        const handleColor = 'rgb(0, 255, 0)';

        // Draw handles (the little circles at the points)
        const handleGroupUID = '0';
        drawHandles(svgDrawingHelper, annotationUID, handleGroupUID, canvasCoordinates, {
            color: handleColor,
            lineWidth,
        });

        // Draw the baseline A-B
        drawLine(
            svgDrawingHelper,
            annotationUID,
            'baseline',
            canvasA,
            canvasB,
            { color, lineWidth, lineDash: [4, 4] }
        );

        renderStatus = true;

        if (canvasCoordinates.length === 3) {
            const canvasC = canvasCoordinates[2];

            // Draw C to A and C to B
            drawLine(
                svgDrawingHelper,
                annotationUID,
                'archLine1',
                canvasC,
                canvasA,
                { color: 'orange', lineWidth }
            );
            drawLine(
                svgDrawingHelper,
                annotationUID,
                'archLine2',
                canvasC,
                canvasB,
                { color: 'orange', lineWidth }
            );

            // Compute perpendicular projection of C onto AB for the height line
            const ab = vec2.sub(vec2.create(), canvasB as vec2, canvasA as vec2);
            const ac = vec2.sub(vec2.create(), canvasC as vec2, canvasA as vec2);
            const abDotAb = vec2.dot(ab, ab);

            if (abDotAb > 0) {
                const t = vec2.dot(ac, ab) / abDotAb;
                const canvasP = vec2.scaleAndAdd(vec2.create(), canvasA as vec2, ab, t);

                drawLine(
                    svgDrawingHelper,
                    annotationUID,
                    'perpendicularLine',
                    canvasC,
                    [canvasP[0], canvasP[1]],
                    { color: 'dodgerblue', lineWidth, lineDash: [4, 4] }
                );
            }

            // Compute stats
            const archHeight = this._calculateArchHeight(points[0], points[1], points[2]);
            const archAngle = this._calculateArchAngle(points[0], points[1], points[2]);

            // Render Text (Angle and Distance)
            const textLines = [
                `Angle: ${archAngle.toFixed(2)}${String.fromCharCode(176)}`,
                `Height: ${archHeight.toFixed(2)} mm`
            ];

            drawTextBox(
                svgDrawingHelper,
                annotationUID,
                'textbox',
                textLines,
                [canvasC[0] + 15, canvasC[1] - 15],
                { color: 'white' }
            );
        }
    }

    return renderStatus;
  };
}

export default FlatfootMeasurementTool;
