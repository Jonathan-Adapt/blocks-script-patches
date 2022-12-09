/*
 * Block system service for making basic web requests to http (or https) servers.
 * Copyright (c) PIXILAB Technologies AB, Sweden (http://pixilab.se). All Rights Reserved.
 * Created 2017 by Mike Fahl.
 */

/**
 * Top level object you can import to make requests.
 */
export var SimpleHTTP: {
	newRequest(url:string, opts?: ReqOpts): Request;
};

/**
 A "fluid" interface for setting various optional request properties,
 and finally firing off the request. Firing the request returns
 a promise that will be resolved/rejected  once the request is
 finished.
 */
export interface Request {
	setTimeout(seconds: number): Request;	// Maximum time the request may take
	header(headerName:string, headerValue:string): Request; // Additional header sent with request

	get<RetType>(): Promise<Response<RetType>>;	// Basic GET request, expected to return RetType (if interpreted)

	// Default mediaType (aka "Content-Type") is "application/json" unless explicitly specified below
	put<RetType>(dataToSend: string,  mediaType?: string): Promise<Response<RetType>>;	// PUT request with supplied data
	post<RetType>(dataToSend: string,  mediaType?: string): Promise<Response<RetType>>;	// POST request with supplied data
}

interface ReqOpts {
	/*	If possible, interpret known response types, and store the result in Response#interpreted.
		Currently supported response types are:

		- "application/json"
		Response#interpreted contains an object, or an array-like
		object (if the outermist JSON data is array). Fields in objects
		hold primitive data and other, nested objects. This method of loading
		JSON data is more efficient than reading it as text and then
		converting it to JSON using the JSON.parse() method.

		- "application/xml" or "text/xml"
		Response#interpreted holds an object corresponding to
		the root element of the XML data. Attributes are provided as named
		properties. Nested content is provided as an attribute with the
		empty string as its key.
	 */
	interpretResponse?: boolean;

	/*	Force interpretation as specified mime type. Useful if the service being called
		doesn't return the correct mime type.
	 */
	interpretAs?: string;

	// Options applicable only for interpreting CSV data.
	columnSeparator?: string, 	// Separator character; default is ',' other common option is '\t'
	escapeChar?: string,		// Escape character; default is none
	quote?: string | false 		// Quote charagter to use, none if false; default is '"'
}

/**
 Status and optional data and headers returned from a successful request.
 */
export interface Response<T> {
	status: number;			// Status code from request (e.g., 200)
	data?: string;			// Result from request, if any (not available if interpreted)
	interpreted?: T;		// Interpreted data returned by request, if any
	type?: string;			// Data type of any response (e.g. "application/json")

	/*	Get the response message header value. If the message header is not present
		then null is returned. If the message header is present but has no
		value then the empty string is returned. If the message header is present
		more than once then the values of joined together and separated by a ','
		character.
	*/
	getHeader(name: string): string|null;
}
